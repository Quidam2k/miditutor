#!/usr/bin/env bash
# Copy Todd's finished scores to Pinocchio's Pieces folder (~/MidiTutor Pieces),
# which the Score tab lists. Run from Solace. The scores are copyrighted: they live in
# Q:/Personal/piano/library and are never committed. Only top-level *.musicxml/*.mxl
# (plus trust.json, the OMR audit's per-score badges, #9644, and versions.json, which
# groups one song's Easy / Harder / My mix files, #9627) are copied; the scanner's
# omr-*/ working folders, partial/ pages and
# *.pre-annotate.musicxml backups are skipped.
# Never call git/python3/cc on the Mac (no Xcode CLT: they pop an install dialog).
set -euo pipefail

PINOCCHIO_HOST=${PINOCCHIO_HOST:-toddwalker@todds-mac-mini}
LIBRARY=${LIBRARY:-/q/Personal/piano/library}
DEST=${PIECES_DEST:-MidiTutor Pieces}  # a scratch folder for tests

shopt -s nullglob nocaseglob
files=()
for f in "$LIBRARY"/*.musicxml "$LIBRARY"/*.mxl; do
  # annotate_scan.py's backups (*.pre-annotate.musicxml) are not pieces.
  # *-my-mix files are made on each box (mixes.json, #9627): never copied, so his own survives.
  [[ $f == *.pre-annotate.* || $f == *-my-mix.* ]] || files+=("$f")
done
(( ${#files[@]} )) || { echo "No scores in $LIBRARY." >&2; exit 1; }
# trust.json is copied alongside the scores so the picker can show each one's badge (#9644).
if [[ -f "$LIBRARY/trust.json" ]]; then files+=("$LIBRARY/trust.json"); fi
if [[ -f "$LIBRARY/versions.json" ]]; then files+=("$LIBRARY/versions.json"); fi

ssh "$PINOCCHIO_HOST" "mkdir -p \"\$HOME/$DEST/review\""
# scp speaks SFTP (OpenSSH 9+): the remote path is taken literally, no shell quoting.
scp "${files[@]}" "${PINOCCHIO_HOST}:$DEST/"
# Scan review (#9666): layouts, event logs, proposals and the system crops, so his
# Review tab works on Pinocchio. Its review/outbox.jsonl is never overwritten
# (the desk app pulls it); the desk's own pushes keep this current after that.
review=("$LIBRARY"/review/*.layout.json "$LIBRARY"/review/*.events.jsonl "$LIBRARY"/review/*.proposals)
if (( ${#review[@]} )); then
  scp -r -q "${review[@]}" "${PINOCCHIO_HOST}:$DEST/review/"
  [[ -d "$LIBRARY/review-pages" ]] && scp -r -q "$LIBRARY/review-pages" "${PINOCCHIO_HOST}:$DEST/"
fi
ssh "$PINOCCHIO_HOST" "ls -1 \"\$HOME/$DEST\""
