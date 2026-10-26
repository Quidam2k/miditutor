# Cascade: scan review mode (#9664 PROCEED, plan-back 35536; sugg #5071; rows 9662/9663)

DONE = Todd can review one piece end to end on Solace, circle a bar and get a fix applied, with a screenshot.
Decided: (A) DESK on Solace, inside the MidiTutor app (Review tab). Not TV, not the WebUI.

## Reviewer adds (must all land)
- Jarvis: no console window (packaged build or hidden launcher) + a desktop shortcut NAME for Jarvis to hand Todd;
  vision re-check concurrency 1 + respect Solace load tripwire (Pantheon src/solace_load.py) + "checking…" on the mark;
  review JSON + log out of git but BACKED UP (Q:/Personal is NOT a git repo: pick a backup, e.g. mirror to a private repo);
  badge text exactly "Verified by you".
- Karen: sort "pieces I'm learning first" (O, Stormy Sea, Sorcerer's, Let Me Fall + favorites) beside worst-first;
  vision re-check on demand per mark only, never batch over unmarked bars (7d usage 70%);
  every proposal shows the scan crop beside the proposed bar; Accept never auto-applies; first .orig kept; per-edit log;
  "Verified by you" stores the date + which systems he confirmed (re-ingest must drop it).

## Facts found (2026-10-26)
- Library Q:/Personal/piano/library: <slug>.musicxml (+ .pre-annotate, .orig), pages/<slug>/NN.png (300 dpi, ~17 MB each,
  2.4 GB total), trust.json {file: {status, note, source}}; omr_audit.merge_trust keeps entries whose source != omr_audit.
- Final XML has <print new-system="yes"/> at printed system starts; NO new-page marks. Page boundaries: per-page homr
  outputs in library/omr-*/pageNNN.musicxml (count measures per page), merge_omr_pages.py concatenates in order.
- System y-bands: homr `--write-staff-positions` (see scripts/omr_second_engine.py:149) or horizontal projection.
- OSMD bar boxes: ScoreView.tsx:225-237 already computes measure rects from GraphicSheet.MeasureList (reuse).
- Repair tool: scripts/omr_fix.py (ops set_time set_key delete_measure replace_measure split_measure transpose_note
  delete_note move_staff; apply_edits returns a copy). Lint: omr_audit.lint_piece(path)['flags'].
- Headless e2e pattern: vite `--config vite.renderer.config.ts --port 5199` + Playwright from
  Q:/Pantheon/.venv-omnivoice python with -I, stub window.tutorBridge via add_init_script (see scratchpad e2e_homework.py).

## Phases
- [ ] P1 data (main process + scripts): scripts/review_layout.py -> library/review/<slug>.layout.json
  {systems:[{page, measures:[first,last], y0,y1}]}; IPC review:list (sorted), review:page (downscaled JPEG via
  nativeImage), review:marks get/save, review:confirmSystem. Tests: pytest for layout on 2 real pieces.
- [ ] P2 UI: ReviewView.tsx (4th top tab "Review", only when the review bridge exists): piece list with both sorts,
  system-at-a-time scan crop beside the OSMD render, SVG circle drawing on both sides -> measure, "this line matches",
  marks list with status checking…/proposal/applied/rejected.
- [ ] P3 proposals: scripts/review_queue.py (Codex if budget, else Sonnet; I review every line): crop bar ±1 from the
  page, headless `claude -p` Sonnet with crop + bar listing -> omr_fix edit list JSON; validate (dry run + re-lint, reject
  if fill worse); single-flight lock + load tripwire. Accept -> omr_fix apply, .orig first-only, review/<slug>.log,
  re-render, sync_pieces.sh. Verified by you -> trust.json {status:'verified-by-you', source:'todd-review', date, systems}.
- [ ] P4 launch + ship: hidden Windows launcher + shortcut "MidiTutor Review" (packaged win32 build, or .vbs launcher
  of the packaged exe with --review --library); e2e; real end to end on a SCRATCH copy of O Holy Night m27; screenshots;
  commit (marker #9664); memory miditutor-scan-review; app build to Pinocchio under idle guard (badge text).

⚠️ NEXT: P1. Start by reading ScoreView.tsx:180-260 and the omr-* page outputs for o-holy-night.
