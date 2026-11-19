import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import omr_grand_staff as g  # noqa: E402

# build(pages, title, lh_insert, rh_insert, drop) takes ElementTrees (one per page) and lists of
# (page, bar) tuples; main(argv) returns its exit code.


def note(step, octave, dur, staff=None, voice=None, typ="quarter", chord=False, lyric=False):
    s = "<note>"
    if chord:
        s += "<chord/>"
    s += f"<pitch><step>{step}</step><octave>{octave}</octave></pitch>"
    s += f"<duration>{dur}</duration>"
    if voice is not None:
        s += f"<voice>{voice}</voice>"
    s += f"<type>{typ}</type>"
    if staff is not None:
        s += f"<staff>{staff}</staff>"
    if lyric:
        s += "<lyric><text>la</text></lyric>"
    return s + "</note>"


def backup(d):
    return f"<backup><duration>{d}</duration></backup>"


def attrs(div, staves=1):
    s = (f"<attributes><divisions>{div}</divisions><key><fifths>0</fifths></key>"
         "<time><beats>4</beats><beat-type>4</beat-type></time>")
    if staves == 2:
        s += ("<staves>2</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef>"
              "<clef number=\"2\"><sign>F</sign><line>4</line></clef>")
    elif staves == 1:
        s += "<clef><sign>F</sign><line>4</line></clef>"
    return s + "</attributes>"


def measure(n, body):
    return f'<measure number="{n}">{body}</measure>'


def part(pid, measures):
    return f'<part id="{pid}">{"".join(measures)}</part>'


def score(*parts):
    ids = "".join(f'<score-part id="{p[10:12]}"><part-name>x</part-name></score-part>' for p in parts)
    return (f'<score-partwise version="4.0"><part-list>{ids}</part-list>'
            f'{"".join(parts)}</score-partwise>')


def tree(xml):
    return ET.ElementTree(ET.fromstring(xml))


def vocal_rh_measure(n, first=True):
    body = attrs(4, 2) if first else ""
    body += note("F", 6, 16, staff=1, voice=1, typ="whole", lyric=True)
    body += backup(16)
    body += note("C", 5, 4, staff=2, voice=1, lyric=True)
    body += note("D", 5, 4, staff=2, voice=1)
    body += note("E", 5, 8, staff=2, voice=1, typ="half")
    body += backup(16)
    body += note("G", 4, 16, staff=2, voice=2, typ="whole")
    return measure(n, body)


def lh_measure(n, first=True, notes=4):
    body = attrs(2, None) if first else ""
    for _ in range(notes):
        body += note("C", 3, 2)
    return measure(n, body)


def page1_xml(rh_bars=1, lh_bars=1):
    p1 = part("P1", [vocal_rh_measure(i + 1, i == 0) for i in range(rh_bars)])
    p2 = part("P2", [lh_measure(i + 1, i == 0) for i in range(lh_bars)])
    return score(p1, p2)


def page2_xml():
    body = attrs(4, 2)
    body += note("C", 5, 16, staff=1, voice=1, typ="whole")
    body += backup(16)
    body += note("C", 3, 16, staff=2, voice=2, typ="whole")
    return score(part("P1", [measure(1, body)]))


def notes_of(m, staff):
    return [n for n in m.findall("note") if n.findtext("staff") == str(staff)]


def test_two_page_join():
    pages = [tree(page1_xml()), tree(page2_xml())]
    out = g.build(pages, "My Title", [], [], [])
    root = out.getroot()
    parts = root.findall("part")
    assert len(parts) == 1
    assert parts[0].get("id") == "P1"
    assert len(root.findall("part-list/score-part")) == 1
    assert root.findtext("work/work-title") == "My Title"
    assert root.find(".//lyric") is None
    assert root.findtext(".//attributes/staves") == "2"
    assert root.findtext(".//attributes/divisions") == "4"
    # no vocal pitches (F6 only appears in vocal staff)
    for n in root.iter("note"):
        p = n.find("pitch")
        assert not (p.findtext("step") == "F" and p.findtext("octave") == "6")

    ms = parts[0].findall("measure")
    assert [m.get("number") for m in ms] == [str(i + 1) for i in range(len(ms))]
    assert len(ms) == 2

    m1 = ms[0]
    rh = notes_of(m1, 1)
    lh = notes_of(m1, 2)
    assert len(rh) == 4  # C5 D5 E5 + G4
    assert len(lh) == 4
    assert {n.findtext("voice") for n in rh} == {"1", "2"}
    assert {n.findtext("voice") for n in lh} == {"5"}
    rh_v1 = [n for n in rh if n.findtext("voice") == "1"]
    assert [n.findtext("duration") for n in rh_v1] == ["4", "4", "8"]
    # LH was divisions 2, quarter=2 -> scaled to 4
    assert [n.findtext("duration") for n in lh] == ["4", "4", "4", "4"]

    m2 = ms[1]
    pr = m2.find("print")
    assert pr is not None and pr.get("new-page") == "yes"
    assert ms[0].find("print") is None or ms[0].find("print").get("new-page") is None
    assert len(notes_of(m2, 1)) == 1
    assert len(notes_of(m2, 2)) == 1
    assert notes_of(m2, 1)[0].findtext("voice") == "1"
    assert notes_of(m2, 2)[0].findtext("voice") == "5"


def test_bar_count_mismatch_refuses_and_insert_fixes(tmp_path, capsys):
    p1 = tmp_path / "p1.musicxml"
    p1.write_text(page1_xml(rh_bars=2, lh_bars=1), encoding="utf-8")
    out = tmp_path / "out.musicxml"

    assert g.main([str(out), "T", str(p1)]) == 2
    assert not out.exists()

    assert g.main([str(out), "T", str(p1), "--lh-insert-rest", "1:1"]) == 0
    assert out.exists()
    root = ET.parse(out).getroot()
    ms = root.findall("part/measure")
    assert len(ms) == 2
    # inserted rest bar is the first LH bar; real LH notes land in bar 2
    assert len(notes_of(ms[1], 2)) == 4


def test_no_overwrite_without_force(tmp_path):
    p1 = tmp_path / "p1.musicxml"
    p1.write_text(page1_xml(), encoding="utf-8")
    out = tmp_path / "out.musicxml"
    out.write_text("sentinel", encoding="utf-8")
    assert g.main([str(out), "T", str(p1)]) == 2
    assert out.read_text(encoding="utf-8") == "sentinel"


def test_check_reports_overfull_bar():
    body = attrs(4, 2)
    body += note("C", 5, 4, staff=1, voice=1) * 5  # 5 beats in 4/4
    body += backup(20)
    body += note("C", 3, 16, staff=2, voice=1, typ="whole")
    xml = score(part("P1", [measure(1, body)]))
    out = g.build([tree(xml)], "T", [], [], [])
    lines = g.check(out)
    assert any("overfull" in ln and "bar 1" in ln and "staff 1" in ln for ln in lines)
    assert not any("bar 1 staff 2" in ln for ln in lines)


def test_chord_tone_whose_head_was_vocal_becomes_a_head():
    body = attrs(4, 2)
    body += note("F", 5, 16, staff=1, voice=1, typ="whole")
    body += note("A", 4, 16, staff=2, voice=1, typ="whole", chord=True)
    lh = measure(1, attrs(4, None) + note("C", 3, 16, typ="whole"))
    out = g.build([tree(score(part("P1", [measure(1, body)]), part("P2", [lh])))], "T", [], [], [])
    rh = notes_of(out.getroot().find("part/measure"), 1)
    assert len(rh) == 1 and rh[0].find("chord") is None
    assert rh[0].findtext("pitch/step") == "A"


def test_backup_inside_one_voice_splits_into_two_runs():
    # homr: a dotted-half rest and running quarters in the SAME voice, overlapping via <backup>.
    body = attrs(4, 2)
    body += note("F", 5, 16, staff=1, voice=1, typ="whole")
    body += backup(16)
    body += "<note><rest/><duration>12</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>"
    body += backup(12)
    for step in "CDEF":
        body += note(step, 4, 4, staff=2, voice=5)
    lh = measure(1, attrs(4, None) + note("C", 3, 16, typ="whole"))
    out = g.build([tree(score(part("P1", [measure(1, body)]), part("P2", [lh])))], "T", [], [], [])
    lines = g.check(out)
    assert not any("overfull" in ln and ln.startswith("bar") for ln in lines), lines
    rh = notes_of(out.getroot().find("part/measure"), 1)
    assert len({n.findtext("voice") for n in rh}) == 2


def test_fit_rests_shortens_a_misread_rest_only_when_asked():
    # homr read an eighth rest as a dotted half: 3 beats of rest + 7 eighths = 6.5 beats.
    body = attrs(4, 2)
    body += "<note><rest/><duration>12</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>"
    for step in "CDEFGAB":
        body += note(step, 4, 2, staff=2, voice=5, typ="eighth")
    lh = measure(1, attrs(4, None) + note("C", 3, 16, typ="whole"))
    page = score(part("P1", [measure(1, body)]), part("P2", [lh]))
    plain = g.build([tree(page)], "T", [], [], [])
    assert any("overfull" in ln and ln.startswith("bar 1") for ln in g.check(plain))
    fitted = g.build([tree(page)], "T", [], [], [], fit_rests=True)
    assert not any(ln.startswith("bar") for ln in g.check(fitted)), g.check(fitted)
    rest = fitted.getroot().find(".//note/rest/..")
    assert rest.findtext("duration") == "2" and rest.findtext("type") == "eighth"
    assert rest.find("dot") is None
    pitches = [n.findtext("pitch/step") for n in fitted.getroot().iter("note") if n.find("pitch") is not None]
    assert pitches == list("CDEFGAB") + ["C"]


def test_fit_rests_two_long_rests_and_a_stray_gap():
    # 2-beat rest, 3 eighths, 2-beat rest, 3 eighths (page shows eighth rests) = 7 beats.
    body = attrs(4, 2)
    for half in range(2):
        body += "<note><rest/><duration>8</duration><voice>5</voice><type>half</type><staff>2</staff></note>"
        for step in "CEG":
            body += note(step, 4, 2, staff=2, voice=5, typ="eighth")
    lh = measure(1, attrs(4, None) + note("C", 3, 16, typ="whole"))
    page = score(part("P1", [measure(1, body)]), part("P2", [lh]))
    fitted = g.build([tree(page)], "T", [], [], [], fit_rests=True)
    assert not any(ln.startswith("bar") for ln in g.check(fitted)), g.check(fitted)
    # an un-fixable bar (8 eighths of notes + a rest that can't shrink to fit) is left alone
    body2 = attrs(4, 2) + "".join(note(s, 4, 2, staff=2, voice=5, typ="eighth") for s in "CDEFGABC")
    body2 += note("D", 5, 2, staff=2, voice=5, typ="eighth")
    page2 = score(part("P1", [measure(1, body2)]), part("P2", [lh]))
    left = g.build([tree(page2)], "T", [], [], [], fit_rests=True)
    assert any("overfull" in ln for ln in g.check(left))
