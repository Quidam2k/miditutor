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
| P1 | versions.json + parse + listPieces group + picker collapse + Easy/Harder switch + sync | in progress |
| P2 | piano-only harder copies (drop vocal part), fix O m17 / Let Me Fall m56 extra bars, seed labels | todo |
| P3 | align_versions.py (melody DTW) -> sections; "Make my mix" builder with side-by-side thumbnails; splice -> <slug>-my-mix.musicxml + recipe; capped trust | todo |

Files P1: src/shared/versions.ts, tests/versions.test.ts, src/main.ts (listPieces), src/renderer/components/tutor/useTutorBridge.ts,
src/renderer/components/score/ScoreView.tsx, src/renderer/store/useSettingsStore.ts, scripts/sync_pieces.sh.

⚠️ NEXT: P1.
