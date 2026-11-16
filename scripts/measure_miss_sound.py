"""#6047: before/after level of the miss sound, rendered offline (no speakers, silent).

    python scripts/measure_miss_sound.py [--cdp http://localhost:9359]

Also prints the A-weighted level of each miss sound (click, buzz, knock) at 100% and 200% against the app's piano note (#5799).
"before" is the old graph (#11561: MembraneSynth A2, pitchDecay .03, octaves 2, 0.18 s, -10 dB), rebuilt in a
plain headless page from node_modules/tone. "after" is the real app code: the packaged app's
window.__missSoundProbe (AudioEngine.renderMissSound), reached over --cdp. Prints peak and RMS dBFS and the
share of energy above 250 Hz. These are rendered-signal levels, NOT a microphone reading on any speaker.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np

TONE = Path(__file__).resolve().parent.parent / "node_modules" / "tone" / "build" / "Tone.js"
OLD = """async () => {
  const buf = await Tone.Offline(() => {
    const s = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 2,
      envelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.05 }, volume: -10 }).toDestination();
    s.triggerAttackRelease('A2', 0.18, 0);
  }, 0.4);
  return { sampleRate: buf.sampleRate, samples: Array.from(buf.getChannelData(0)) };
}"""
PIANO = """async () => {
  const buf = await Tone.Offline(() => {
    const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.8 }, volume: -8 }).toDestination();
    s.triggerAttackRelease('C4', '8n', 0, 0.8);
  }, 0.6);
  return { sampleRate: buf.sampleRate, samples: Array.from(buf.getChannelData(0)) };
}"""


def stats(label: str, r: dict) -> dict:
    x = np.asarray(r["samples"], dtype=np.float64)
    sr = r["sampleRate"]
    peak = float(np.max(np.abs(x)))
    active = x[: int(sr * 0.25)]
    rms = float(np.sqrt(np.mean(active**2))) if len(active) else 0.0
    spec = np.abs(np.fft.rfft(x)) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    hi = float(spec[freqs >= 250].sum() / spec.sum()) if spec.sum() else 0.0
    # Loudness as a TV with no output below 250 Hz would deliver it: rebuild with the low band removed.
    spec_hi = np.fft.rfft(x)
    spec_hi[freqs < 250] = 0
    y = np.fft.irfft(spec_hi, n=len(x))
    tv_peak = float(np.max(np.abs(y)))
    db = lambda v: 20 * math.log10(v) if v > 0 else float("-inf")  # noqa: E731
    # A-weighted level (how loud it SOUNDS: the ear is most sensitive near 3 kHz), over the sound's first 0.25 s.
    f = np.maximum(freqs, 1.0)
    f2 = f**2
    ra = (12194**2 * f2**2) / ((f2 + 20.6**2) * np.sqrt((f2 + 107.7**2) * (f2 + 737.9**2)) * (f2 + 12194**2))
    a_gain = ra / ra[np.argmin(np.abs(freqs - 1000))]
    xa = np.fft.irfft(np.fft.rfft(x) * a_gain, n=len(x))[: int(sr * 0.25)]
    arms = float(np.sqrt(np.mean(xa**2))) if len(xa) else 0.0
    out = {"peak": db(peak), "rms": db(rms), "above250": hi * 100, "tv_peak": db(tv_peak), "arms": db(arms)}
    print(f"{label:<26} peak {out['peak']:6.1f} | rms {out['rms']:6.1f} | A-weighted rms {out['arms']:6.1f} dBFS | >=250 Hz {out['above250']:5.1f}% | peak <250 Hz removed {out['tv_peak']:6.1f}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdp", default="http://localhost:9359")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch(args=["--mute-audio"])
        page = b.new_page()
        page.set_content("<html></html>")
        page.add_script_tag(path=str(TONE))
        old = stats("before (old thud)", page.evaluate(OLD))
        piano = stats("app piano note C4", page.evaluate(PIANO))
        b.close()
        app = p.chromium.connect_over_cdp(args.cdp)
        ap_page = app.contexts[0].pages[0]
        res = {}
        for kind in ("click", "buzz", "knock"):
            for pct in (100, 200):
                res[(kind, pct)] = stats(f"{kind}, Miss volume {pct}%", ap_page.evaluate(f"() => window.__missSoundProbe({pct}, '{kind}')"))
    print("\nHow loud it sounds (A-weighted rms) against the app's own piano note C4, and against the #6047 knock at 100%:")
    for (kind, pct), r in res.items():
        print(f"  {kind:<6} {pct:>3}%: {r['arms'] - piano['arms']:+6.1f} dB re piano, {r['arms'] - res[('knock', 100)]['arms']:+6.1f} dB re old knock")
    return 0


if __name__ == "__main__":
    sys.exit(main())
