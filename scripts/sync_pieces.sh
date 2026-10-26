#!/usr/bin/env bash
# Copy Todd's finished scores to Pinocchio's Pieces folder (~/MidiTutor Pieces),
# which the Score tab lists. Run from Solace. The scores are copyrighted: they live in
# Q:/Personal/piano/library and are never committed. Only top-level *.musicxml/*.mxl
# are copied; the scanner's omr-*/ working folders and partial/ pages are skipped.
# Never call git/python3/cc on the Mac (no Xcode CLT: they pop an install dialog).
set -euo pipefail

PINOCCHIO_HOST=${PINOCCHIO_HOST:-toddwalker@todds-mac-mini}
LIBRARY=${LIBRARY:-/q/Personal/piano/library}
DEST='MidiTutor Pieces'

shopt -s nullglob nocaseglob
files=("$LIBRARY"/*.musicxml "$LIBRARY"/*.mxl)
(( ${#files[@]} )) || { echo "No scores in $LIBRARY." >&2; exit 1; }

ssh "$PINOCCHIO_HOST" "mkdir -p \"\$HOME/$DEST\""
# scp speaks SFTP (OpenSSH 9+): the remote path is taken literally, no shell quoting.
scp "${files[@]}" "${PINOCCHIO_HOST}:$DEST/"
ssh "$PINOCCHIO_HOST" "ls -1 \"\$HOME/$DEST\""
