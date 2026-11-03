"""#5412 #5410 end-to-end on a hidden Electron app. Raw MIDI bytes go through the real WebMidi.js,
useMidi, the store and the follower; only navigator.requestMIDIAccess is faked, so the port can be
power-cycled. A repeated note needs its own press, before and after the keyboard drops, and the
wheel moves the score while he picks a loop.

    MIDITUTOR_HIDDEN=1 MIDITUTOR_WINDOW_SIZE=1600x900 MIDITUTOR_PORT=47812 MIDITUTOR_VITE_PORT=5183 \
      npx electron-forge start -- --remote-debugging-port=9346 --user-data-dir=<scratch>
    MIDITUTOR_URL=http://127.0.0.1:47812 MIDITUTOR_TOKEN_FILE=<scratch>/api-token \
      MIDITUTOR_CDP=http://127.0.0.1:9346 python scripts/e2e_repeat_notes.py
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9346")
TITLE = "Repeat notes test"
E3, GS3, C4, C5, D5 = 52, 56, 60, 72, 74
FAILS: list[str] = []

FAKE_MIDI = """
(() => {
  const port = {
    id: 'fake-1', name: 'Fake Roland', manufacturer: 'Test', version: '1', type: 'input',
    state: 'connected', connection: 'open', onmidimessage: null, onstatechange: null,
    open: async function () { return this; }, close: async function () { return this; },
    addEventListener() {}, removeEventListener() {},
  };
  const access = {
    inputs: new Map([['fake-1', port]]), outputs: new Map(), sysexEnabled: false, onstatechange: null,
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
  const settle = () => new Promise((r) => setTimeout(r, 300));
  window.__midi = {
    send(status, note, vel) {
      port.onmidimessage({ data: new Uint8Array([status, note, vel]), timeStamp: performance.now(), target: port, currentTarget: port });
    },
    async drop() { port.state = 'disconnected'; port.connection = 'pending'; access.inputs.delete('fake-1'); access.onstatechange?.({ port }); await settle(); },
    async back() { port.state = 'connected'; port.connection = 'open'; access.inputs.set('fake-1', port); access.onstatechange?.({ port }); await settle(); },
  };
})();
"""


def check(cond, label, detail="") -> None:
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def note_xml(pitches: list[tuple[str, int, int]]) -> str:
    out = []
    for i, (step, alter, octave) in enumerate(pitches):
        chord = "<chord/>" if i else ""
        alt = f"<alter>{alter}</alter>" if alter else ""
        out.append(
            f"<note>{chord}<pitch><step>{step}</step>{alt}<octave>{octave}</octave></pitch>"
            "<duration>1</duration><type>quarter</type></note>"
        )
    return "".join(out)


def fixture() -> str:
    """Bar 1 has the shape of Sorcerer's Apprentice bar 29; the rest give the strip room to scroll."""
    first = (
        note_xml([("C", 0, 5), ("G", 1, 3), ("E", 0, 3)])
        + note_xml([("C", 0, 5)])
        + note_xml([("C", 0, 5), ("C", 0, 4)])
        + note_xml([("D", 0, 5)])
    )
    rest = "".join(note_xml([(s, 0, 4)]) for s in "EFGA")
    bars = [
        '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>'
        "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>"
        f"</attributes>{first}</measure>"
    ]
    bars += [f'<measure number="{n}">{rest}</measure>' for n in range(2, 25)]
    return (
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list>'
        '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
        f'<part id="P1">{"".join(bars)}</part></score-partwise>'
    )


def screen() -> dict:
    return tc.state().get("screen") or {}


def wait_for(cond, label: str, timeout: float = 20) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.1)
    check(False, f"timed out: {label}", str(screen())[:300])
    return False


def play(page, moves: list[tuple[str, int, int]]) -> list[dict]:
    """Moves are (on|off, note, ms to wait first): 0 means the same tick. Returns the new events."""
    since = tc.request("GET", "/events?limit=1")["lastSeq"]
    page.evaluate(
        """async (moves) => {
          for (const [kind, note, wait] of moves) {
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            window.__midi.send(kind === 'on' ? 0x90 : 0x80, note, kind === 'on' ? 64 : 0);
          }
        }""",
        moves,
    )
    time.sleep(0.25)
    return tc.request("GET", f"/events?since={since}&limit=2000")["events"]


def count(events: list[dict], kind: str, note: int) -> int:
    return sum(1 for e in events if e.get("kind") == kind and e.get("note") == note and e.get("source") == "hardware")


def follows(events: list[dict]) -> list[tuple[int, str, int]]:
    return [(e["note"], e["result"], e["step"]) for e in events if e.get("kind") == "follow"]


def to_start() -> None:
    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 1})
    time.sleep(0.4)


def on(note: int, wait: int = 0) -> tuple[str, int, int]:
    return ("on", note, wait)


def off(note: int, wait: int = 0) -> tuple[str, int, int]:
    return ("off", note, wait)


def scenarios(page, label: str) -> None:
    to_start()
    ev = play(page, [on(C5)])
    check(count(ev, "noteon", C5) == 1, f"{label}: one note-on per press", str(ev))
    ev = play(page, [off(C5)])
    check(count(ev, "noteoff", C5) == 1, f"{label}: one note-off per release", str(ev))

    # Msg 54341: the chord's last note is the C5, and the next step is C5 alone.
    to_start()
    ev = play(page, [on(E3), on(GS3, 4), on(C5, 4)])
    got = follows(ev)
    check(got == [(E3, "partial", 0), (GS3, "partial", 0), (C5, "advance", 0)], f"{label}: last-note C5 finishes only its own step", str(got))
    check(len(screen().get("remaining") or []) == 1, f"{label}: the next C5 is still to play", str(screen().get("remaining")))
    play(page, [off(E3), off(GS3), off(C5)])

    # Msg 54338: the C5 is held while another note finishes the chord.
    to_start()
    ev = play(page, [on(C5), on(E3, 4), on(GS3, 4)])
    got = follows(ev)
    check(all(step == 0 for _, _, step in got), f"{label}: a held C5 is not carried on by an echo", str(got))
    play(page, [off(E3), off(GS3), off(C5)])
    ev = play(page, [on(C5)])
    check(follows(ev) == [(C5, "advance", 1)], f"{label}: the repeated C5 takes its own press", str(follows(ev)))
    play(page, [off(C5)])

    # Step 92 in the report: a two-note step, low note first, 15 ms apart.
    ev = play(page, [on(C4), on(C5, 15)])
    got = follows(ev)
    check(got == [(C4, "partial", 2), (C5, "advance", 2)], f"{label}: C4 alone does not finish C5+C4", str(got))
    play(page, [off(C4), off(C5)])

    # A real fast repeat is never eaten: no debounce anywhere.
    to_start()
    ev = play(
        page,
        [on(E3), on(GS3), on(C5), off(E3), off(GS3), off(C5), on(C5, 1), off(C5), on(C4), on(C5)],
    )
    advances = [(n, s) for n, r, s in follows(ev) if r == "advance"]
    check(advances == [(C5, 0), (C5, 1), (C5, 2)], f"{label}: fast repeats each count", str(follows(ev)))
    check(count(ev, "noteon", C5) == 3, f"{label}: three presses, three note-ons", str(count(ev, "noteon", C5)))
    play(page, [off(C4), off(C5)])


def power_cycle(page, label: str) -> None:
    since = tc.request("GET", "/events?limit=1")["lastSeq"]
    page.evaluate("() => window.__midi.drop()")
    page.evaluate("() => window.__midi.back()")
    time.sleep(0.3)
    events = tc.request("GET", f"/events?since={since}&limit=2000")["events"]
    device = [e["connected"] for e in events if e.get("kind") == "device"]
    check(device == [False, True], f"{label}: the feed shows the keyboard drop and return", str(device))


def score_scroller(page, prop: str) -> dict | None:
    """The nearest ancestor of the score that can scroll that way, with its position."""
    return page.evaluate(
        """(prop) => {
          const horizontal = prop === 'scrollLeft';
          let el = document.querySelector('svg g.vf-measure')?.closest('svg')?.parentElement;
          for (; el; el = el.parentElement) {
            const style = getComputedStyle(el);
            const overflow = horizontal ? style.overflowX : style.overflowY;
            const room = horizontal ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight;
            if (room && (overflow === 'auto' || overflow === 'scroll')) {
              const r = el.getBoundingClientRect();
              return { pos: el[prop], x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
          return null;
        }""",
        prop,
    )


def bar_point(page) -> dict:
    """A point on a drawn bar, as near the middle of the window as there is one."""
    return page.evaluate(
        """() => {
          const mid = innerWidth / 2;
          const bars = [...document.querySelectorAll('g.vf-measure')]
            .map((g) => g.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight)
            .sort((a, b) => Math.abs(a.left + a.width / 2 - mid) - Math.abs(b.left + b.width / 2 - mid));
          const r = bars[0];
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }"""
    )


def head_point(page) -> dict:
    """The middle of a notehead inside the window."""
    return page.evaluate(
        """() => {
          const r = [...document.querySelectorAll('.vf-notehead')]
            .map((h) => h.getBoundingClientRect())
            .find((h) => h.width > 0 && h.left > innerWidth / 4 && h.right < (3 * innerWidth) / 4 && h.top > 0 && h.bottom < innerHeight);
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }"""
    )


def set_layout(page, value: str) -> None:
    page.get_by_test_id(f"layout-{value}").click()
    page.wait_for_timeout(1200)


def clear_loop() -> None:
    tc.request("DELETE", "/loop")
    time.sleep(0.4)


def wheel(page, point: dict, dy: int, times: int) -> None:
    page.mouse.move(point["x"], point["y"])
    for _ in range(times):
        page.mouse.wheel(0, dy)
        page.wait_for_timeout(80)


def wheel_checks(page) -> None:
    set_layout(page, "strip")
    clear_loop()
    page.get_by_test_id("loop-bars").click()
    wait_for(lambda: screen().get("pickingLoop") == "start", "picking the first bar")
    # On a notehead on purpose: this used to open the finger picker over the music.
    point = head_point(page)
    page.mouse.click(point["x"], point["y"])
    wait_for(lambda: screen().get("pickingLoop") == "end", "picking the last bar")
    check(page.get_by_test_id("finger-picker").count() == 0, "strip: picking a bar on a note opens no finger picker")

    before = score_scroller(page, "scrollLeft")
    bar_before = page.get_by_test_id("bar-now").input_value()
    if not before:
        check(False, "strip: the score panel can scroll sideways")
        return
    wheel(page, before, 120, 8)
    after = score_scroller(page, "scrollLeft")
    check(after["pos"] - before["pos"] > 8 * 40, "strip: the wheel slides the music while picking", f"{before['pos']} -> {after['pos']}")
    check(page.get_by_test_id("bar-now").input_value() == bar_before, "strip: the cursor stays put while picking")
    check(screen().get("pickingLoop") == "end", "strip: still picking the last bar", str(screen().get("pickingLoop")))

    wheel(page, after, -120, 2)
    back = score_scroller(page, "scrollLeft")
    check(back["pos"] < after["pos"], "strip: the wheel slides back", f"{after['pos']} -> {back['pos']}")

    point = bar_point(page)
    page.mouse.click(point["x"], point["y"])
    wait_for(lambda: bool(screen().get("loop")), "the loop to be set")
    loop = screen().get("loop") or {}
    check(loop.get("firstBar", 0) < loop.get("lastBar", 0), "strip: a bar found by wheel ends the loop", str(loop))

    for layout in ("pages", "scroll"):
        set_layout(page, layout)
        clear_loop()
        page.get_by_test_id("loop-bars").click()
        wait_for(lambda: screen().get("pickingLoop") == "start", f"{layout}: picking the first bar")
        point = bar_point(page)
        page.mouse.click(point["x"], point["y"])
        wait_for(lambda: screen().get("pickingLoop") == "end", f"{layout}: picking the last bar")
        before = score_scroller(page, "scrollTop")
        if not before:
            check(False, f"{layout}: the score can scroll down")
        else:
            wheel(page, before, 200, 4)
            after = score_scroller(page, "scrollTop")
            check(after["pos"] != before["pos"], f"{layout}: the wheel scrolls while picking", f"{before['pos']} -> {after['pos']}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
    set_layout(page, "strip")


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.add_init_script(FAKE_MIDI)
        page.reload()
        wait_for(lambda: tc.state().get("device", {}).get("connected") is True, "the fake keyboard to connect")
        tc.request("POST", "/piece", {"title": TITLE, "musicxml": fixture()})
        wait_for(lambda: screen().get("piece") == TITLE and screen().get("status") == "ready", "the test piece")
        page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
        set_layout(page, "strip")

        scenarios(page, "fresh port")
        power_cycle(page, "first drop")
        scenarios(page, "after a power cycle")
        power_cycle(page, "second drop")
        scenarios(page, "after a second power cycle")
        wheel_checks(page)

    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
