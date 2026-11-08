#!/usr/bin/env bash
# Read Pinocchio's live /state and the deploy gate (#10143: last note >= 20 min ago, invite off).
# Read-only: it only runs tr and curl on the Mac. All parsing happens HERE, on purpose (#10251):
# git, python3, cc and make are Xcode CLT shims there, and running one over ssh puts an
# "install developer tools" dialog on his screen.
# Prints the gate on stdout; exit 0 = open, 1 = closed, 2 = could not read it.
set -euo pipefail

# Machine-specific host (gitignored): scripts/local.env, or set PINOCCHIO_HOST.
[[ -f "$(dirname "${BASH_SOURCE[0]}")/local.env" ]] && source "$(dirname "${BASH_SOURCE[0]}")/local.env"
PINOCCHIO_HOST=${PINOCCHIO_HOST:?set PINOCCHIO_HOST or scripts/local.env}
support='Library/Application Support/MidiTutor'

state=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$PINOCCHIO_HOST" \
  "T=\$(tr -d '[:space:]' < \"\$HOME/$support/api-token\"); curl -s --max-time 3 -H \"Authorization: Bearer \$T\" http://127.0.0.1:47800/state; echo; echo \"ETIME:\$(ps -o etime= -p \$(pgrep -x MidiTutor | head -1) 2>/dev/null)\"") || {
  echo 'gate: unknown (could not reach the app; it may be closed)'
  exit 2
}

printf '%s' "$state" | python -c '
import json, sys, time
raw = sys.stdin.read()
body, _, tail = raw.rpartition("ETIME:")
try:
    s = json.loads(body if _ else raw)
except ValueError:
    print("gate: unknown (no JSON from /state)")
    sys.exit(2)
invite = bool((s.get("invite") or {}).get("active"))
last = s.get("lastNoteAt")
def minutes(etime):  # ps etime: [[dd-]hh:]mm:ss
    days, _, rest = etime.strip().rpartition("-")
    parts = [int(p) for p in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return int(days or 0) * 1440 + parts[0] * 60 + parts[1] + parts[2] / 60
try:
    up = minutes(tail) if tail.strip() else None
except ValueError:
    up = None
idle = None if last is None else (time.time() * 1000 - last) / 60000
# #5353: no note since launch counts from the launch. He may have just opened it to play, so a
# launch under 20 min old (or an unreadable one) stays closed; one days old is idle (11/8: 2 days).
since_launch = last is None and up is not None
if since_launch:
    idle = up
open_ = not invite and idle is not None and idle >= 20
print(f"invite active: {invite}")
if since_launch:
    print(f"last note: none since launch {up:.0f} min ago")
else:
    print("last note: none since launch (idle time unknown)" if idle is None else f"last note: {idle:.1f} min ago")
print("gate: OPEN" if open_ else "gate: CLOSED")
sys.exit(0 if open_ else 1)
'
