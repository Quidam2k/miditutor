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
- [x] P3 DONE 2026-10-26 17:50: scripts/review_queue.py (Codex gate refused -> Sonnet draft, reviewed every line)
  `propose SLUG MARK` / `apply SLUG PID`, last stdout line JSON, exit 0/2/3 busy/4 low RAM (<6 GiB)/5 stale.
  Crop = 300-dpi page rotated by layout angle, bar ±1, red bracket over target. Lean `claude -p` Sonnet, --tools Read,
  temp cwd with crop.png (~8 s, ~$0.02 list-eq). Validate: only the marked bar, no structural ops, apply_edits, lint
  bar±1: reject if target bar_length count rises or a new flag appears next door. Records in
  review/<slug>.proposals/<pid>.{json,png,musicxml}. Locks: .queue.lock (propose) / .apply.lock (apply never waits on
  a check). apply -> omr_fix.main (.orig first-only) + review/<slug>.log. omr_fix replace_measure now carries
  tie/notations(minus tuplet)/lyric to rebuilt notes matched per staff by pitch (fingering survived rhythm fix).
  Main (src/main/review.ts): piece.checks {checking|waiting|needed|done+proposal}; one check at a time; queued on mark,
  "still wrong", piece open, after accept (stale ready proposals re-check); busy/low-RAM -> held, retry 60 s;
  accept(slug,pid) -> apply, accept event, ensureLayout, trust; recheck; proposalView. IPC review:accept/recheck/proposal.
  UI: CheckBadge + CheckDetail (crop, Now vs Proposed BarRender, Accept / Still wrong + note / Try again), polls 4 s.
  Real run (scratch copy, O Holy Night m26: LH triplet-eighths misread) -> correct fix, lint flag cleared.
  Tests: pytest 46 (review_queue + omr_fix), vitest 207; e2e scratchpad e2e_review_p3.py 13/13 + P2 e2e PASS;
  screengrab/9664-p3-proposal.png, -accepted.png. Scratch lib: this session's scratchpad/lib (applied there, not real).
- [x] P4 DONE 2026-10-26 18:15: scripts/install_review_desk.py copies the packaged build (out/ is replaced by every
  package run) to %LOCALAPPDATA%/MidiTutor Review and writes Desktop shortcut "MidiTutor Review" (GUI exe: no console;
  helpers windowsHide). Flags: --review-library/-python/-scripts/-backup. Backup (Jarvis add 3): scripts/backup_review.py
  mirrors events/logs/proposal json/changed scores/trust.json -> Q:/project-reports/miditutor/review-backup, path-only
  commit + push (shared repo; index.lock retry); review.ts runs it on start + 60 s after his last write (single flight).
  Seeded: project-reports 3f0bb62 pushed. Tests: pytest test_backup_review 3, vitest 207.
  Real e2e IN THE INSTALLED APP (scratchpad e2e_review_p4.py; copy in project-reports/miditutor/9664-e2e_review_p4.py):
  launches the shortcut's own target+flags hidden (MIDITUTOR_HIDDEN=1, CDP), scratch lib + scratch backup repo.
  m27: vision "matches the scan" (correct, crop checked) -> "no change found". m26: real proposal 9-13 s (LH triplets
  -> plain eighths), Accept -> score changed, .orig untouched, log, backup committed+pushed. 15/15 PASS.
  screengrab/9664-p4-{checking,proposal,accepted,nochange-m27}.png. Seen: m30 has the same triplet misread (his to mark).
  Pinocchio deploy DEFERRED to end of P5: no piece is verified yet (badge can't show), P5 changes the Pinocchio app,
  and a deploy leaves MidiTutor closed there. Memory miditutor-scan-review (Pantheon cca8959 + project memory).

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

## P5 design (2026-10-26 18:35, recycled session)
- (a) BLOCKED, reported event 35589: tutor tunnel is Solace->Pinocchio `ssh -L 47800` on demand; nothing on Solace
  listens. Building (b) only. Pinocchio marks get checked only while the desk app is open (mirror says so).
- ssh: Windows OpenSSH (System32, what the packaged app sees) works BY IP toddwalker@192.168.50.27, BatchMode;
  hostname todds-mac-mini does NOT resolve (also breaks sync_pieces.sh/deploy default right now).
- Pinocchio = same Review class, cfg.mirror (auto when ~/MidiTutor Pieces/review exists): list by layout.json; no
  python/trust/backup; his actions -> review/outbox.jsonl (lines carry slug); accept -> accept_request event,
  "Try again" -> recheck event; readEvents = events.jsonl + outbox (dedupe); outbox pruned of ids Solace has.
- Desk: cfg.pinocchio (--review-pinocchio) -> pull() at start + every 2 min, single flight: ssh cat outbox, merge new
  ids (origin pinocchio, allowed kinds only), ensureLayout (queues checks), trust, then requests (accept_request ->
  accept(), failure -> request_failed event; recheck -> recheck()); first pull of a session re-scans all slugs.
  push(slug) debounced after merge / check done / accept / desk append: scp proposals, crops, layout, events,
  score, trust.json. Remote transport injectable (tests). Shared types gain accept_request/recheck/request_failed.
- sync_pieces.sh also copies review/*.json(l), review/*.proposals, review-pages/.
- #9763 (jarvis ruling): ship (b) only; mirror wording "Waiting for Solace. It's checked next time MidiTutor Review is
  running there."; final report must say how many marks typically wait. Acked event 35590.
- P5 CODE DONE (uncommitted, 18:30): review.ts (mirror, Remote/sshRemote, pull/carryOut/pushDirty, restart-safe
  recheck), shared/review.ts kinds, main.ts wiring, sync_pieces.sh, install_review_desk.py --review-pinocchio=IP.
  vitest 210/210 (+3 round-trip tests, mutation-checked). Real sshRemote push/outbox OK vs Pinocchio
  ~/MidiTutor Review Test (scratch; delete after). REMAINING: package+install desk, real e2e in installed app
  (scratch lib, MIDITUTOR_REVIEW_REMOTE_DIR=MidiTutor Review Test, outbox mark -> proposal pushed -> accept_request
  -> applied), mirror UI e2e (installed exe, no review flags, MIDITUTOR_PIECES_DIR=local mirror copy), Codex review of
  diff, commit, CI dispatch + idle-guarded deploy, real sync_pieces, complete 9664/9667/9668/9763.

## P6 = Todd's first-use fixes (#9764 sugg #5075, info #9765 msg 50750, #9766 Karen). Plan-back 35593 (HIGH) +
amend 35594; WAIT for [ORCH PROCEED]. Do after P5 commit, BEFORE the Pinocchio deploy (one deploy for both).
(3) many marks per line: pending becomes a list, each circle its own pending mark + note; Enter saves all; Esc drops last.
(4) circle keeps what he circled: draw his circle, no whole-bar amber fill (thin outline); mark gains `notes`
  (score side: OSMD notes inside circle; scan side: circle x-span mapped onto same bar of rendered line); list shows
  "Bar 26, LH: E3 G3 (beat 2)"; review_queue.py crop draws his circle + prompt names the notes. One bar per mark.
(2) beams: scores have NO <beam> (o-holy-night 0/309 eighths); ReviewView.tsx:76 autoBeam:false -> true. Render only.
(1) speed: review_layout.py writes lint-flagged bars per line as layout `suspects`; J/K next/prev suspect bar,
  arrows = line, Space (or Enter with nothing pending) = confirm line + next line; refuses on a line with an open mark.
Tests: vitest multi-pending/circle-notes/suspect nav; pytest suspects + circle prompt; installed-app e2e screenshots.
APPROVED #9767 (jarvis+karen) with AMENDS: a circle spanning bar lines = ONE MARK PER BAR it covers, each with its
own notes; on-screen key legend in Review view (J/K, arrows, C/Space, Enter, Esc); J/K strictly navigation (never
confirm); C (and Space) confirm only the line on screen, then move on; no bulk confirm; a mark that would be dropped
(outside any bar, or Esc) SAYS SO on screen; ANNOUNCE the restart in the room before the Pinocchio deploy closes the app.

P5 COMMITTED a45576f (pushed), NOT deployed. Real e2e 18/18 x2 on final build (scratchpad e2e_review_p5.py; copy
Q:/project-reports/miditutor/9666-e2e_review_p5.py; run: E2E_LNK='Q:\UserData\Desktop\MidiTutor Review.lnk'
Q:/Pantheon/.venv-omnivoice/Scripts/python.exe -I e2e_review_p5.py [BAR], bar 30 gives a real fix; bar 26 may say
no change). Sonnet review fixes folded in. Waiting-mark count for Jarvis's #9763 report: 0 real marks so far
(nothing deployed yet); say so and that the count needs a week of use.

P6 PROGRESS (uncommitted, in tree), 2026-10-26 ~18:50:
- DONE + VERIFIED: ReviewView JSX + keys (Space/C confirm+advance, Enter save, Esc drop last, J/K suspect jump, never
  confirms; legend review-keys; amber suspect dots; notices). OSMD autoBeam does NOT beam x/8 (splits every eighth), so
  src/renderer/engine/autoBeam.ts addBeams() adds <beam> to the in-memory XML before load (render only; vitest checks
  O Holy Night pitches/durations unchanged). reviewMain fixture got suspects: [] (else flaky: layout re-run each test).
  vitest 225 (6 runs green), pytest 48, tsc clean. Real library layouts have suspects (81 pieces). Packaged+installed.
  Installed-app e2e 22/22 PASS: scratchpad e2e_review_p6.py (copy Q:/project-reports/miditutor/9764-e2e_review_p6.py),
  screenshots screengrab/9764-p6-*.png. Codex gate refused (17%); Sonnet second read running/done.
- DONE 2026-10-26 ~19:05: Sonnet read fixed (double-save, held-key confirm, grace in beams, bad circle); 71a92cf
  pushed; CI 40435150517 -> deployed to Pinocchio, sync_pieces run, app relaunched -g. 9662-9668, 9763-9767 closed;
  #5071 + #5075 closed. CASCADE COMPLETE.
- Then DEPLOY P5+P6: ANNOUNCE in the room first (orch_report to Jarvis that MidiTutor on Pinocchio will close for a
  restart) -> gh workflow run macos.yml --ref master, gh run watch, confirm headSha -> idle-guarded deploy_pinocchio.sh
  with PINOCCHIO_HOST=toddwalker@192.168.50.27 (name doesn't resolve) -> real sync_pieces.sh (same host) so the
  Review tab appears on Pinocchio -> report app left CLOSED. Rm Mac scratch "~/MidiTutor Review Test" if left.
- Then complete 9664, 9667, 9668, 9763, 9764 (closes: #5075), 9765, 9766, 9767; memory=miditutor-scan-review (update
  for P5 mirror/pull + P6). Report waiting-mark count (#9763).

⚠️ NEXT: P5 (AMEND #9666 above): review_layout 150-dpi crops already exist (review-pages/); sync_pieces.sh carries
review-pages + review/*.json(l) + proposals; Pinocchio Review tab reads ~/MidiTutor Pieces/review, appends to outbox;
review_queue.py pull (scp, merge by event id, run proposals, push back); desk app 2-min pull timer while open; Pinocchio
ping over the tutor tunnel (report a blocker if no Solace-side listener). Repaired scores reach Pinocchio via the pull's
sync. Then CI dispatch + idle-guarded Pinocchio deploy (memory deploy-pinocchio-needs-ci-dispatch), then close
9664/9667/9668.
