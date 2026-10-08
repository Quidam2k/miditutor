#!/usr/bin/env bash
set -euo pipefail

APP_BINARY="out/MidiTutor-darwin-arm64/MidiTutor.app/Contents/MacOS/MidiTutor"
TEMP_DIR="${RUNNER_TEMP:-/tmp}"
APP_LOG="$TEMP_DIR/miditutor-smoke.log"
BODY="$TEMP_DIR/body.json"
TOKEN_FILE="$HOME/Library/Application Support/MidiTutor/api-token"
PID=""

cleanup() {
  local exit_code=$?
  set +e

  if [[ "$exit_code" -ne 0 ]]; then
    printf '\nFAIL: MidiTutor macOS smoke test\n' >&2
    printf '\n--- App log (last 100 lines) ---\n' >&2
    if [[ -f "$APP_LOG" ]]; then
      tail -n 100 "$APP_LOG" >&2
    else
      printf 'App log unavailable.\n' >&2
    fi

    printf '\n--- Last response body ---\n' >&2
    if [[ -f "$BODY" ]]; then
      cat "$BODY" >&2
      printf '\n' >&2
    else
      printf 'Response body unavailable.\n' >&2
    fi
  fi

  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
  fi
  pkill -f 'MidiTutor.app' || true

  exit "$exit_code"
}

trap cleanup EXIT

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

: > "$APP_LOG"
: > "$BODY"

[[ -x "$APP_BINARY" ]] || fail "App binary is missing or not executable: $APP_BINARY"

nohup "$APP_BINARY" > "$APP_LOG" 2>&1 &
PID=$!

deadline=$((SECONDS + 60))
while [[ ! -s "$TOKEN_FILE" ]]; do
  (( SECONDS < deadline )) || fail "Timed out waiting for the API token."
  sleep 2
done

TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
[[ -n "$TOKEN" ]] || fail "API token is empty after removing whitespace."

deadline=$((SECONDS + 60))
ready=0

while (( SECONDS < deadline )); do
  STATUS="$(curl -s --max-time 2 -o "$BODY" -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    http://127.0.0.1:47800/state)" || STATUS=""

  if [[ "$STATUS" == "200" ]] && python3 -c '
import json
import sys

with open(sys.argv[1], encoding="utf-8") as response:
    body = json.load(response)
sys.exit(0 if isinstance(body, dict) and body.get("ok") is True else 1)
' "$BODY" 2>/dev/null; then
    ready=1
    break
  fi

  if (( SECONDS < deadline )); then
    sleep 2
  fi
done

[[ "$ready" == "1" ]] || fail "Timed out waiting for /state to return HTTP 200 with JSON ok: true."

STATUS="$(curl -s --max-time 5 -o "$BODY" -w '%{http_code}' \
  http://127.0.0.1:47800/state)" || fail "Unauthenticated /state request failed."

[[ "$STATUS" == "401" ]] || fail "Unauthenticated /state returned HTTP $STATUS; expected 401."

printf 'PASS: MidiTutor macOS arm64 launched, authenticated /state returned ok: true, and unauthenticated /state returned 401.\n'
