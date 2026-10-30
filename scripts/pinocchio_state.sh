#!/usr/bin/env bash
# Read Pinocchio's live /state and the deploy gate (#10143: last note >= 20 min ago, invite off).
# Read-only: it only runs tr and curl on the Mac. All parsing happens HERE, on purpose (#10251):
# git, python3, cc and make are Xcode CLT shims there, and running one over ssh puts an
# "install developer tools" dialog on his screen.
# Prints the gate on stdout; exit 0 = open, 1 = closed, 2 = could not read it.
set -euo pipefail

PINOCCHIO_HOST=${PINOCCHIO_HOST:-toddwalker@192.168.50.27}
support='Library/Application Support/MidiTutor'

state=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$PINOCCHIO_HOST" \
  "T=\$(tr -d '[:space:]' < \"\$HOME/$support/api-token\"); curl -s --max-time 3 -H \"Authorization: Bearer \$T\" http://127.0.0.1:47800/state") || {
  echo 'gate: unknown (could not reach the app; it may be closed)'
  exit 2
}

printf '%s' "$state" | python -c '
import json, sys, time
try:
    s = json.load(sys.stdin)
except ValueError:
    print("gate: unknown (no JSON from /state)")
    sys.exit(2)
invite = bool((s.get("invite") or {}).get("active"))
last = s.get("lastNoteAt")
idle = None if last is None else (time.time() * 1000 - last) / 60000
# No note since launch means idle time is unknown, and he may have just opened it to play: closed.
open_ = not invite and idle is not None and idle >= 20
print(f"invite active: {invite}")
print("last note: none since launch (idle time unknown)" if idle is None else f"last note: {idle:.1f} min ago")
print("gate: OPEN" if open_ else "gate: CLOSED")
sys.exit(0 if open_ else 1)
'
