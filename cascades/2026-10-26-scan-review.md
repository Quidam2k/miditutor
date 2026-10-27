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
- [x] P1 DONE 2026-10-26 17:25 (commit pending /simplify). Files: scripts/review_layout.py (+tests/test_review_layout.py
  14 incl. learning-first regression), src/shared/review.ts (fold, measureAtX, systemOfMeasure; tests/review.test.ts),
  src/main/review.ts (Review: list/piece/ensureLayout/crop/append/updateTrust; tests/reviewMain.test.ts), trust.ts
  'verified' (needs score_sha256; badge "Verified by you: <Mon D, YYYY>, all N lines", mark U+2714), main.ts listPieces
  drops a verified badge whose sha != file (Pinocchio too), IPC review:info/list/piece/crop/append, preload review*.
  Enabled only by --review-library=<dir> (+ --review-python, --review-scripts; env MIDITUTOR_REVIEW_*).
  Layout = scan is authoritative for systems + barline x; barlines[] always holds both system ends (no edge field).
  Detector: deskew, staves = 5 evenly spaced lines (strays skipped), extent = median per-line span (gap 25, border
  columns masked), edge snap within 4 staff spaces, barline kept if gapfill>=.5 (connected pages) / isolated.
  Library run (2m36s, 81 pieces): 54 exact / 17 partial / 10 none (0 systems: eine-kleine is a 10346-px tall page,
  kum-ba-yah/minuet-d-minor/scotland/oak-ash/toreador/drunken-sailor/she-ll-be/bright-lights: not looked at yet).
  All 4 learning-first exact: o-from-o, the-stormy-sea, sorcerers-apprentice, let-me-fall-from-quidam.
  Crops (150 dpi JPEG) replace the planned nativeImage page IPC. Re-run after every accept (ensureLayout does it).
  Rule: confirm only on mapped lines; verified needs match exact + layout sha == score sha.
- [x] P2 DONE 2026-10-26 17:35: src/renderer/components/review/ReviewView.tsx (Sonnet draft, Codex gate refused; reviewed
  every line), App.tsx 4th tab "Review" only when tutorBridge.reviewInfo() != null (main column max-w-7xl on that tab),
  shared/review.ts systemRange (unmapped line -> bars between the mapped lines around it) / cropToPage / staffAtY (+tests).
  OSMD: load once per piece sha, per line setOptions drawFrom/UpToMeasureNumber + stretchLastSystemLine, bar boxes from
  MeasureList entries with ParentMusicSystem. Overlay svg viewBox = crop natural px (scan) / OSMD svg size (score).
  e2e: scratchpad e2e_review.py (stub bridge serves real library data, folds with real shared/review.ts via Vite import),
  17/17 PASS; screengrab/9664-p2-*.png. Open marks show "checking…" (P3 supplies proposals).
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
  Trigger (#9667, replaces the scheduled task -- NO Pantheon/Windows task, it would wake a persona 720x/day):
  (b) the Solace desk app, while open, runs `review_queue.py pull` on a 2-min timer; (a) the Pinocchio app, while
  its Review tab is open, pings Solace over the existing tutor tunnel/API ("outbox has N") and Solace pulls on it.
  Blocker on (a) -> report at P5 start; (c) script-only runner only via Orolo. Plan-back 35547 APPROVED (#9668, jarvis).
  Mark shows "checking…" until a proposal arrives.

⚠️ NEXT: P3 proposals (scripts/review_queue.py + Accept/Reject UI in ReviewView marks list). Backup of review/ (Jarvis add 3): P4 decides (Pinocchio copy via sync in P5 + ?).
