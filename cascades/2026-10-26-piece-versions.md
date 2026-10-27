# Cascade: easy and harder versions of a piece, plus his own mix (#9627, sugg #5060)

Approved: plan-back #35623, PROCEED #9770 (jarvis + karen). Defaults taken: mix is per SECTION; harder
versions are piano-only copies (vocal+piano originals stay on disk). Do not put questions to Todd tonight.

DONE = in the picker, O / Let Me Fall / Quidam each show once with an Easy / Harder switch, and he can build and
save "My mix" (easy or harder per section) that plays, follows and loops like any piece, desk and Pinocchio.

## Cross-phase decisions
- `versions.json` beside trust.json in the library (Q:/Personal/piano/library, synced by sync_pieces.sh):
  `{slug: {title, versions: [{file, label, mixable?}], sections?: [...]}}`. Parsed by src/shared/versions.ts.
- A grouped piece's Piece.label is the GROUP title (favorites/sort by it); the version label rides on
  `piece.group.label`. The tutor API reports `"<title> (<version>)"`.
- Last-chosen version per group: settings `pieceVersions[slug] = file` (by slug, never by title).
- Reviewer adds (#9770): compute (alignment, any OMR repair) only under the 9634 guard (idle/overnight);
  mix builder shows each section's bars side by side from both versions (pick by sight); Quidam harder is
  "Harder (unchecked)" and NOT mixable until repaired; Easy sections keep fingering, Harder sections are
  marked "no fingering" (not an error); a mix's trust is capped at its weakest source, never "verified by
  you", and the badge names unchecked source sections; alignment output must stay shaped so per-hand /
  note-level hybrids (his real need: easy + notes lifted from harder) can sit on it later.

## Phases
| # | What | Status |
|---|------|--------|
| P1 | versions.json + parse + listPieces group + picker collapse + Easy/Harder switch + sync | DONE (P1 commit; e2e 13/13, scratchpad e2e_versions_p1.py) |
| P2 | DONE (e2e 6/6, scratchpad e2e_versions_p2.py). IN PLACE, originals kept as <file>.musicxml.orig (precedent o-holy-night); piano-only harder copies (drop vocal part), fix O m17 / Let Me Fall m56 extra bars, seed labels | DONE except Quidam (below) |
| P3a | align_versions.py + src/shared/mix.ts splice (+ transpose) + tests | DONE (pytest 14, vitest 11+2; real O dry-run via pure fns: semis -2, diagonal 34 bars, 9 sections, cost 0-0.30). Real-library align run PENDING on idle gate |
| P3b | My mix builder UI (side-by-side thumbnails), save IPC, mixes.json, capped trust, e2e, deploy + sync | CODE DONE (e2e 13/13 on scratch lib, Q:/project-reports/miditutor/9627-e2e_versions_p3.py; run with MIDITUTOR_PORT=47811 + CDP 9346 because two stale dev instances from P1/P2 hold 47800/9335 and the kill was denied). DEPLOYED to Pinocchio 21:05 (CI 40440991181 = d404a12; asar has the mix code; app relaunched with open -g). PENDING: real align run (gate) + sync |

Files P1: src/shared/versions.ts, tests/versions.test.ts, src/main.ts (listPieces), src/renderer/components/tutor/useTutorBridge.ts,
src/renderer/components/score/ScoreView.tsx, src/renderer/store/useSettingsStore.ts, scripts/sync_pieces.sh.

P2 notes: O m17 carries <divisions>4</divisions>, LMF m56 carries key fifths=-5: both must move into the next bar.
Trust notes' bar numbers above the dropped bar shift down by one. review_layout.py --force for the 3 slugs, but
only when the idle gate is open (omr_second_engine.input_idle_s() >= 600 s, ram >= 12 GB); Todd was active 19:15.
Script: scripts/piece_versions.py piano-only (Sonnet-drafted; Codex gate refused 17% vs 15%).

P2 result: O harder 35->34 bars (m17 dropped, divisions carried), LMF harder piano-only 73 bars (was showing
only 10: OSMD cuts a score to its shortest part, and the vocal part had 10). Trust note for O shifted (20->19, 25->24).
QUIDAM HARDER NOT CHANGED: its piano part fails OSMD at bar 37 (overlapping voices, misread rhythm), so the vocal
original is back in place (it shows the first 14 bars, as before tonight). The piano-only copy is kept in the
scratchpad as quidam-piano-only-fails-bar37.musicxml. Follow-up: OMR repair of quidam-musicnotes, under the 9634 guard.
PENDING (idle gate): review_layout.py --force o-musicnotes-arrangement let-me-fall-musicnotes-vocal-arrangement
(their bar counts changed, so the Review tab's system->bar map is stale after the dropped bar).

## P3 design (decided 19:35; amendment reported to orch)
KEYS DIFFER: O Easy C (fifths 0), O Harder D (2); LMF Easy C, LMF Harder reads -5 then 0 from bar 16 (OMR key
misread); Quidam both -2 (but harder excluded). Fingering: Easy files have it (78/100/117 marks), Harder none.
Default taken: a mix is in the EASY key; Harder sections are transposed into it at splice time (chromatic shift
by the bar-1 key difference, respelled diatonically: step moves by the letter distance, alter fixes the rest).
A harder file whose key changes where the easy one doesn't (LMF) is NOT mixable until its keys are repaired
(versions.json mixable:false). So tonight My mix works for O only.
P3a
- scripts/align_versions.py <slug>: refuses unless the idle gate is open (omr_second_engine.gate_ok: >=600 s
  idle, >=12 GB) per #9770. For Easy vs each mixable Harder: per bar, melody = highest staff-1 pitch per onset,
  transposed into the easy key; DTW over bars (cost = normalized edit distance of the pitch-class sequences);
  writes into versions.json group (FINAL SHAPE, 20:00): `align: {<harder file>: {semis, bars: [[easyBar, harderBar], ...],
  sections: [{easy:[a,b], harder:[c,d], cost}]}}` (bars = the raw DTW path, kept so per-hand / note-level hybrids can
  reuse it, karen add 1). Bar cost = 1 - 2*LCS/(la+lb) on top-pitch pitch classes (embellishment-tolerant). Cuts only
  at a diagonal step where (easyBar-1)%4==0.
  parseVersions must keep align/sections.
- src/shared/mix.ts spliceMix(easyXml, harderXml, sections, choice[], semis): the easy part's measures for Easy
  sections, the harder part's (transposed) measures for Harder ones; the first bar of every segment gets the full
  effective attributes of its source (divisions, key = easy key, time, staves, clefs); a "Harder: no fingering"
  <words> direction opens each Harder segment (karen add 2); renumber; title "<title> (My mix)". vitest.
P3b
- Mix files are made on whichever box he is on, so they live in mixes.json (LOCAL, never synced: desk sync would
  clobber them), merged into the group by listPieces as {label "My mix", mixable false}. IPC pieces:saveMix(slug,
  choice[]) writes <slug>-my-mix.musicxml + mixes.json + a trust entry: weakest source wins (issues > unverified >
  checked), never verified, note names the harder bars used (karen add 3), source "piece-versions".
- UI: "Make my mix" next to the switch when the group has sections; one row per section with Easy and Harder
  thumbnails side by side (OSMD drawFromMeasureNumber / drawUpToMeasureNumber, small), a toggle, Save.
- e2e (scratch lib, CDP 9335): build an O mix, save, "My mix" in the switch, loads, inject notes across a splice,
  loop over it. Then CI dispatch + deploy_pinocchio.sh, sync_pieces.sh, check on Pinocchio, leave the app as found.

Notes P3b: renderer splices (DOMParser; xmldom is dev-only), main validates + writes; builder is a portal (toolbar was its fixed box); a splice restates only attributes that change (no redrawn 4/4).
## CASCADE COMPLETE #9627 (2026-10-26 23:10, worker picker-38e9)
- Idle gate open (71 min idle, 22 GB): align_versions.py o -> semis -2, 9 sections (matches dry-run); written to library versions.json.
- review_layout.py --force: O harder exact (34/34, 9 systems). LMF harder: match "none" -- its scan pages are 3 staves/system
  (vocal+piano), the piano-only XML is 2. Follow-up, not part of DONE.
- sync_pieces.sh to Pinocchio (versions.json with align confirmed there; app running, d404a12 code from the 21:05 deploy).
- Desk "MidiTutor Review" install predated P1 (18:49): repackaged + install_review_desk.py.
- e2e 9627-e2e_versions_p3.py 13/13 on dev AND on the installed desk exe (packaged needs MIDITUTOR_ALLOW_INJECT=1), scratch copies of the real files.
- Not checked: Pinocchio's picker on screen (app not on the Score view; did not drive his Mac).
- Follow-ups: LMF harder key repair (bar 16) + Review stave mismatch; Quidam harder OMR repair; per-hand / note-level hybrids on group.align.bars;
  two stale hidden dev instances (electron PIDs 26172, 47276) hold 47800/9335 and 47811/9346 -- kill denied to workers.
