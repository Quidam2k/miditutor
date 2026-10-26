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

## AMEND #9666 (Todd msg 50722): BOTH surfaces, shared core, desk FIRST
Todd sits at Pinocchio on a stool with keyboard + mouse/trackball. Build: desk interface (P1-P4 above), THEN P5.
- One store on Solace (authoritative): library/review/<slug>.events.jsonl, append-only events
  {id uuid, origin solace|pinocchio, ts, kind mark|confirm_system|accept|reject|note, ...}; state = fold of events.
  Both UIs read/write events only (no whole-file last-write-wins).
- Conflict rule: merge by event id. A later mark on a system voids that system's confirm. Accept applies only if the
  proposal's base sha256 == current score file; else "score changed, re-checking" and re-queue. Verified-by-you is
  recomputed from the fold on every apply.
- P5 Pinocchio data path: review_layout.py also writes 150-dpi JPEG system crops -> library/review-pages/<slug>/;
  sync_pieces.sh copies review-pages + review/*.json(l) + proposals to ~/MidiTutor Pieces/review/.
  Pinocchio app appends its events to ~/MidiTutor Pieces/review/outbox/*.jsonl (persisted until acked).
  Solace `review_queue.py pull` (scp only, no tunnel needed): fetch outbox -> merge -> run proposals (single flight,
  load tripwire) -> push proposals + merged events + repaired scores back (sync_pieces). App fs.watch's review/.
  Trigger: a Pantheon scheduled task (like #319, owner jarvis) every 2 min, no-op on empty outbox -- Jarvis creates it.
  Mark shows "checking…" until a proposal arrives.

⚠️ NEXT: P1. Start by reading ScoreView.tsx:180-260 and the omr-* page outputs for o-holy-night.
