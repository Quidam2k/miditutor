#!/usr/bin/env bash
# Copy Todd's finished scores from the library to BOTH boxes' Pieces folders
# (~/MidiTutor Pieces), which the Score tab lists: Pinocchio over ssh, and this box
# (Solace) locally, so the two pickers list the same pieces (#6390). Run from Solace
# after adding or fixing a piece. The scores are copyrighted: they live in the local
# score library and are never committed. Only top-level *.musicxml/*.mxl (plus
# trust.json, the per-score badges, #9644, and versions.json, which groups one song's
# Easy / Harder / My mix files, #9627) are copied; the scanner's omr-*/ working
# folders, partial/ pages and *.pre-annotate.musicxml backups are skipped.
#
# Newer wins (#6390): a file is copied only when the destination lacks it or has an
# OLDER copy, and copies keep the library's time. So a fingering edit he saved on
# either box (written into that box's folder, #9988) is never overwritten by an older
# library file. --dry-run lists what would be copied and changes nothing.
# SOLACE_PIECES='' skips this box; PINOCCHIO_HOST='' skips the Mac.
# Never call git/python3/cc on the Mac (no Xcode CLT: they pop an install dialog);
# only ls, mkdir and BSD stat run there.
set -euo pipefail

DRY=0
[[ ${1:-} == --dry-run ]] && DRY=1

# The Mac's address lives in scripts/local_config.json (pinocchio_host; not in git).
config_host=$(sed -n 's/.*"pinocchio_host": *"\([^"]*\)".*/\1/p' "$(dirname "$0")/local_config.json" 2>/dev/null || true)
PINOCCHIO_HOST=${PINOCCHIO_HOST-$config_host}
LIBRARY=${LIBRARY:-/q/Personal/piano/library}
DEST=${PIECES_DEST:-MidiTutor Pieces}  # a scratch folder for tests
SOLACE_PIECES=${SOLACE_PIECES-$HOME/MidiTutor Pieces}

shopt -s nullglob nocaseglob
files=()
for f in "$LIBRARY"/*.musicxml "$LIBRARY"/*.mxl; do
  # Backups (*.pre-annotate.musicxml from annotate_scan.py, *.pre-<fix>.musicxml from hand fixes) are not pieces.
  # *-my-mix files are made on each box (mixes.json, #9627): never copied, so his own survives.
  [[ $f == *.pre-* || $f == *-my-mix.* ]] || files+=("$f")
done
(( ${#files[@]} )) || { echo "No scores in $LIBRARY." >&2; exit 1; }
for extra in trust.json versions.json; do
  [[ -f "$LIBRARY/$extra" ]] && files+=("$LIBRARY/$extra")
done

# stale <mtimes-file>: print the library files the destination lacks or holds older.
# The mtimes file has one "<epoch seconds> <name>" line per destination file. Names
# match ignoring case: the Mac's disk treats Song.mxl and song.mxl as one file.
stale() {
  local f name mine theirs
  for f in "${files[@]}"; do
    name=${f##*/}
    mine=$(stat -c %Y "$f") || return 1
    theirs=$(awk -v n="$name" '{t=$1; sub(/^[0-9]+ /, ""); if (tolower($0) == tolower(n)) print t}' "$1")
    if [[ -z $theirs ]] || (( theirs < mine )); then printf '%s
' "$f"; fi
  done
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
times=$work/times list=$work/list

# Pieces he added on Pinocchio itself (a MIDI import, #6309) come back to the library
# first, so this box lists them too. Test leftovers, backups and My mix files stay put,
# and so do names scp would read as a pattern ([, *, ?).
if [[ -n $PINOCCHIO_HOST ]]; then
  ssh "$PINOCCHIO_HOST" "ls -1 \"\$HOME/$DEST\"" > "$list"
  mapfile -t theirs < "$list"
  for name in "${theirs[@]}"; do
    [[ $name == *.musicxml || $name == *.mxl ]] || continue
    [[ $name == *.pre-* || $name == *-my-mix.* || $name == *[eE]2[eE]* || $name == *[][*?]* ]] && continue
    [[ -e "$LIBRARY/$name" ]] && continue
    echo "From Pinocchio: $name"
    if (( ! DRY )); then
      # Into a temp name first, so a broken transfer never leaves half a score in the library.
      scp -p "${PINOCCHIO_HOST}:$DEST/$name" "$work/pulled"
      mv "$work/pulled" "$LIBRARY/$name"
      files+=("$LIBRARY/$name")
    fi
  done
fi

if [[ -n $SOLACE_PIECES ]]; then
  (( DRY )) || mkdir -p "$SOLACE_PIECES"
  : > "$times"
  for g in "$SOLACE_PIECES"/*; do
    [[ -f $g ]] || continue
    t=$(stat -c %Y "$g")
    echo "$t ${g##*/}" >> "$times"
  done
  stale "$times" > "$list"
  mapfile -t todo < "$list"
  echo "Solace ($SOLACE_PIECES): ${#todo[@]} to copy"
  for f in "${todo[@]}"; do
    echo "  ${f##*/}"
    if (( ! DRY )); then cp -p "$f" "$SOLACE_PIECES/"; fi
  done
fi

if [[ -n $PINOCCHIO_HOST ]]; then
  # Any failure here (the folder, or a file's time) stops the run rather than reading as
  # "missing" and overwriting a newer copy. ./ keeps a name like -x.mxl from reading as a flag.
  ssh "$PINOCCHIO_HOST" "set -e; mkdir -p \"\$HOME/$DEST/review\"; cd \"\$HOME/$DEST\"; for g in *; do if [ -f \"\$g\" ]; then /usr/bin/stat -f '%m %N' \"./\$g\"; fi; done" > "$list"
  sed 's|^\([0-9]*\) \./|\1 |' "$list" > "$times"
  stale "$times" > "$list"
  mapfile -t todo < "$list"
  echo "Pinocchio ($PINOCCHIO_HOST): ${#todo[@]} to copy"
  for f in "${todo[@]}"; do echo "  ${f##*/}"; done
  if (( ! DRY && ${#todo[@]} )); then
    # scp speaks SFTP (OpenSSH 9+): the remote path is taken literally, no shell quoting.
    scp -p "${todo[@]}" "${PINOCCHIO_HOST}:$DEST/"
  fi
  # Scan review (#9666): layouts, event logs, proposals and the system crops, so his
  # Review tab works on Pinocchio. Its review/outbox.jsonl is never overwritten
  # (the desk app pulls it); the desk's own pushes keep this current after that.
  review=("$LIBRARY"/review/*.layout.json "$LIBRARY"/review/*.events.jsonl "$LIBRARY"/review/*.proposals)
  if (( ! DRY && ${#review[@]} )); then
    scp -r -q "${review[@]}" "${PINOCCHIO_HOST}:$DEST/review/"
    if [[ -d "$LIBRARY/review-pages" ]]; then scp -r -q "$LIBRARY/review-pages" "${PINOCCHIO_HOST}:$DEST/"; fi
  fi
fi
