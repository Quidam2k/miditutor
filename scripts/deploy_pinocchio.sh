#!/usr/bin/env bash
# Install the latest CI macOS build on Pinocchio over SSH (no toolchain needed on the Mac).
# Never call git/python3/cc on the Mac: without Xcode CLT they pop an install dialog on the TV.
# Never call osascript on the Mac either (#5412): it can put a permission dialog on his screen,
# and he has already complained about one (2026-11-02). Stop the app with plain SIGTERM, and don't
# bring it forward: it may reopen behind whatever is in front.
# The app it replaces stays in ~/miditutor-previous/MidiTutor.app. To go back: stop the app, then
# move that over ~/Applications/MidiTutor.app.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/deploy_pinocchio.sh [--no-verify | --help]
Install the latest successful master macOS build and verify a hidden launch.
Environment:
  PINOCCHIO_HOST  SSH destination (default: toddwalker@todds-mac-mini)
  RUN_ID         GitHub Actions run ID (default: latest successful macos.yml)
  PANTHEON_CERT  Solace's WebUI cert, pinned by "Bring in the tutor" (default: Q:/Pantheon/certs/cert.pem)
  PANTHEON_URL   written to the app's pantheon-url when set (the app defaults to https://192.168.50.139:7861)
  RELAUNCH=0     leave the app closed even if it was running (default: reopen it if it was)
USAGE
}
verify=true
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --no-verify) verify=false ;;
  "") ;;
  *) usage >&2; exit 2 ;;
esac
if (( $# > 1 )); then usage >&2; exit 2; fi

PINOCCHIO_HOST=${PINOCCHIO_HOST:-toddwalker@todds-mac-mini}
RUN_ID=${RUN_ID:-$(gh run list --workflow macos.yml --branch master --status success -L 1 --json databaseId -q '.[0].databaseId')}
[[ -n "$RUN_ID" && "$RUN_ID" != null ]] || { echo "No successful run found." >&2; exit 1; }
tmpdir=$(mktemp -d)
trap 'rm -rf -- "$tmpdir"' EXIT
gh run download "$RUN_ID" -n MidiTutor-macos-arm64 -D "$tmpdir"
shopt -s nullglob globstar
zips=("$tmpdir"/**/*.zip)
(( ${#zips[@]} == 1 )) || { echo "Expected exactly one .zip artifact." >&2; exit 1; }
scp "${zips[0]}" "${PINOCCHIO_HOST}:miditutor-deploy.zip"

# #10236: a patch puts him back where he was, so note whether the app is open before it stops.
was_running=$(ssh "$PINOCCHIO_HOST" 'pgrep -x MidiTutor >/dev/null && echo yes || echo no')

# "Bring in the tutor" (#5154): the app pins Solace's self-signed WebUI cert (public, not a secret).
PANTHEON_CERT=${PANTHEON_CERT:-/q/Pantheon/certs/cert.pem}
support='Library/Application Support/MidiTutor'
if [[ -s "$PANTHEON_CERT" ]]; then
  ssh "$PINOCCHIO_HOST" "mkdir -p \"\$HOME/$support\" && cat > \"\$HOME/$support/pantheon-cert.pem\"" < "$PANTHEON_CERT"
else
  echo "WARNING: no Pantheon cert at $PANTHEON_CERT; Bring in the tutor will say it can't reach Pantheon." >&2
fi
if [[ -n "${PANTHEON_URL:-}" ]]; then
  printf '%s\n' "$PANTHEON_URL" | ssh "$PINOCCHIO_HOST" "cat > \"\$HOME/$support/pantheon-url\""
fi

# Tell the next launch this is a patch: it puts his loop and progress back however long the wait was.
if [[ "$was_running" == yes ]]; then
  ssh "$PINOCCHIO_HOST" "touch \"\$HOME/$support/restore-next\""
fi

ssh "$PINOCCHIO_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
# Unpack and check the new build first: a bad zip must leave the old app where it is.
rm -rf "$HOME/miditutor-new"
mkdir -p "$HOME/miditutor-new" "$HOME/miditutor-previous" "$HOME/Applications"
ditto -x -k "$HOME/miditutor-deploy.zip" "$HOME/miditutor-new/"
test -x "$HOME/miditutor-new/MidiTutor.app/Contents/MacOS/MidiTutor"
# Stop the app before replacing its bundle: SIGTERM, and -9 only if it won't exit.
pkill -x MidiTutor || true
for ((i=0; i<15; i++)); do
  pgrep -x MidiTutor >/dev/null || break
  sleep 1
done
if pgrep -x MidiTutor >/dev/null; then
  echo 'MidiTutor ignored SIGTERM for 15 s; using SIGKILL.' >&2
  pkill -9 -x MidiTutor || true
  sleep 1
fi
if [[ -d "$HOME/Applications/MidiTutor.app" ]]; then
  rm -rf "$HOME/miditutor-previous/MidiTutor.app"
  mv "$HOME/Applications/MidiTutor.app" "$HOME/miditutor-previous/MidiTutor.app"
fi
mv "$HOME/miditutor-new/MidiTutor.app" "$HOME/Applications/MidiTutor.app"
rm -rf "$HOME/miditutor-new" "$HOME/miditutor-deploy.zip"
xattr -dr com.apple.quarantine "$HOME/Applications/MidiTutor.app" 2>/dev/null || true
REMOTE

if "$verify"; then
  ssh "$PINOCCHIO_HOST" 'bash -s' <<'REMOTE'
set +x
set -euo pipefail
quit_app() {
  rm -f /tmp/mt_state.json
  pkill -x MidiTutor || true
  for ((j=0; j<15; j++)); do
    pgrep -x MidiTutor >/dev/null || break
    sleep 1
  done
  if pgrep -x MidiTutor >/dev/null; then
    echo 'The hidden check copy ignored SIGTERM for 15 s; using SIGKILL.' >&2
    pkill -9 -x MidiTutor || true
    sleep 1
  fi
  rm -rf "$verify_data"
}
# The check runs on its own user data: it must not touch his tab, piece or session (#10236).
verify_data=$(mktemp -d /tmp/miditutor-verify.XXXXXX)
# Cleanup also runs if launch or verification fails.
trap quit_app EXIT
open -n -g -j --env MIDITUTOR_HIDDEN=1 -a "$HOME/Applications/MidiTutor.app" --args "--user-data-dir=$verify_data"
token_file="$verify_data/api-token"
for ((i=0; i<60; i++)); do
  test -s "$token_file" && break
  sleep 1
done
test -s "$token_file"
TOKEN=$(tr -d '[:space:]' < "$token_file")
test -n "$TOKEN"
for ((i=0; i<60; i++)); do
  code=$(curl -s --max-time 2 -o /tmp/mt_state.json -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" http://127.0.0.1:47800/state || true)
  # Wait for Web MIDI too: WebMidi.enable() resolves a few seconds after the renderer connects.
  if [[ "$code" == 200 ]] && grep -Eq '"ok":[[:space:]]*true' /tmp/mt_state.json &&
     grep -Eq '"midiEnabled":[[:space:]]*true' /tmp/mt_state.json; then
    break
  fi
  sleep 1
done
test "$code" = 200
grep -Eq '"ok":[[:space:]]*true' /tmp/mt_state.json
grep -Eq '"midiEnabled":[[:space:]]*true' /tmp/mt_state.json
printf 'auth /state: 200, midiEnabled\n'
grep -oE '"(rendererConnected|device)"[[:space:]]*:[[:space:]]*(true|false|null|"[^"]*"|\{[^}]*\})' /tmp/mt_state.json
code=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:47800/state)
test "$code" = 401
printf 'unauth /state: 401\n'
REMOTE
fi
if [[ "$was_running" == yes && "${RELAUNCH:-1}" != 0 ]]; then
  ssh "$PINOCCHIO_HOST" 'open -a "$HOME/Applications/MidiTutor.app"'
  # Opened over ssh it may come up behind whatever is in front; no osascript to raise it (see top).
  printf 'MidiTutor reopened on %s\n' "$PINOCCHIO_HOST"
else
  printf 'MidiTutor left closed on %s (it was running: %s)\n' "$PINOCCHIO_HOST" "$was_running"
fi
printf 'PASS: MidiTutor deployed to %s\n' "$PINOCCHIO_HOST"
