#!/usr/bin/env bash
# #5077: scripts/e2e_tutor.py on a REAL CoreMIDI port on Pinocchio, with nothing installed.
# Run from Solace: bash scripts/e2e_mac_iac.sh   (ssh from a worker's Bash needs the sandbox off)
#
# The IAC Driver (macOS's built-in loopback bus) is switched ON only for the run and OFF right
# after, so it never sits beside the Roland while he plays (Todd msg 58196). Steps:
#   idle gate -> back up com.apple.MIDI (ByHost) -> stop his app (SIGTERM, restore-next marker,
#   as a deploy does) -> IAC online + restart MIDIServer -> hidden, muted test copy on its own
#   user data -> e2e_tutor.py --cdp-out: the copy's renderer sends to "IAC Driver Bus 1" through
#   WebMIDI and its WebMidi input hears it come back -> ALWAYS: stop the copy, restore the backup,
#   restart MIDIServer, check IAC is offline, reopen his app if it was open.
# His app must be closed while IAC is online: useMidi attaches the FIRST input, IAC sorts ahead
# of the Roland, and an app that saw MIDIServer restart could end up on IAC, deaf to the piano.
# Never runs python3/git/osascript on the Mac (#10251 CLT shims): only sh, defaults, plutil,
# killall, pgrep/pkill, open.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
[[ -f "$here/local.env" ]] && source "$here/local.env"
H=${PINOCCHIO_HOST:?set PINOCCHIO_HOST or scripts/local.env}
API_PORT=${API_PORT:-47899}          # test copy's tutor API (his app keeps 47800)
CDP_REMOTE=9345 CDP_LOCAL=${CDP_LOCAL:-9361}
UD=/tmp/miditutor-iac-ud
BACKUP=miditutor-midi-backup.plist   # in $HOME on the Mac
support='Library/Application Support/MidiTutor'
scratch=$(mktemp -d)
remote() { ssh -o BatchMode=yes -o ConnectTimeout=8 "$H" "$@"; }

bash "$here/pinocchio_state.sh" || { echo 'Idle gate closed or unreadable: not running.'; exit 3; }

# Find the IAC device in the MIDI setup (its index is not fixed), from the live prefs.
remote "defaults -currentHost export com.apple.MIDI /tmp/mt-midi-now.plist"
idx=$(remote "for i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  m=\$(plutil -extract MIDISetup.devices.\$i.model raw -o - /tmp/mt-midi-now.plist 2>/dev/null) || continue
  [ \"\$m\" = 'IAC Driver' ] && { echo \$i; break; }; done; true")
[[ -n "$idx" ]] || { echo 'No IAC Driver in the MIDI setup.'; exit 4; }
iac_offline() {
  remote "defaults -currentHost export com.apple.MIDI /tmp/mt-midi-now.plist &&
    plutil -extract MIDISetup.devices.$idx.offline raw -o - /tmp/mt-midi-now.plist; rm -f /tmp/mt-midi-now.plist"
}
is_off() { [[ "$1" == true || "$1" == 1 ]]; }
if ! is_off "$(iac_offline)"; then
  # Online before we touch it: only ours if an earlier run died and left its backup behind.
  if remote "test -f \"\$HOME/$BACKUP\""; then
    remote "defaults -currentHost import com.apple.MIDI \"\$HOME/$BACKUP\" && killall MIDIServer; sleep 3"
    is_off "$(iac_offline)" && remote "rm -f \"\$HOME/$BACKUP\""
    echo "IAC was left online by an earlier run; restored it from ~/$BACKUP (offline=$(iac_offline)). Run again."
  else
    echo 'IAC is online and not by us; leaving it alone.'
  fi
  exit 5
fi
remote "defaults -currentHost export com.apple.MIDI \"\$HOME/$BACKUP\""

was_running=$(remote 'pgrep -x MidiTutor >/dev/null && echo yes || echo no')
tunnel_pid=

cleanup() {
  set +e
  [[ -n "$tunnel_pid" ]] && kill "$tunnel_pid" 2>/dev/null
  # [-] keeps the pattern from matching the remote shell running this very command line.
  remote "pkill -f -- '[-]-user-data-dir=$UD'; sleep 3; pkill -9 -f -- '[-]-user-data-dir=$UD'; rm -rf $UD; true"
  local off try
  for try in 1 2; do  # twice: in case MIDIServer writes its old setup back on the way out
    remote "defaults -currentHost import com.apple.MIDI \"\$HOME/$BACKUP\" && killall MIDIServer; sleep 3"
    sleep 5
    off=$(iac_offline)
    is_off "$off" && break
  done
  if is_off "$off"; then echo 'IAC Driver back OFF.'; remote "rm -f \"\$HOME/$BACKUP\""
  else echo "WARNING: IAC Driver offline=$off after restore; backup kept at ~/$BACKUP on the Mac." >&2; fi
  if [[ "$was_running" == yes ]]; then
    remote "open -g -a \"\$HOME/Applications/MidiTutor.app\"" && echo 'His MidiTutor reopened.'
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT

if [[ "$was_running" == yes ]]; then
  remote "touch \"\$HOME/$support/restore-next\"; pkill -x MidiTutor
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do pgrep -x MidiTutor >/dev/null || break; sleep 1; done
    pgrep -x MidiTutor >/dev/null && { pkill -9 -x MidiTutor; sleep 1; }; true"
fi

# IAC online: edit a copy of the backup, import it through cfprefsd, restart MIDIServer.
remote "cp \"\$HOME/$BACKUP\" /tmp/mt-midi-on.plist &&
  plutil -replace MIDISetup.devices.$idx.offline -integer 0 /tmp/mt-midi-on.plist &&
  defaults -currentHost import com.apple.MIDI /tmp/mt-midi-on.plist && rm -f /tmp/mt-midi-on.plist &&
  killall MIDIServer; sleep 3"
off=$(iac_offline)
[[ "$off" == false || "$off" == 0 ]] || { echo "IAC did not come online (offline=$off)."; exit 6; }
echo 'IAC Driver ON for the run.'

remote "rm -rf $UD; open -n -g -j --env MIDITUTOR_HIDDEN=1 --env MIDITUTOR_PORT=$API_PORT \
  --env MIDITUTOR_AUTO_INVITE=off -a \"\$HOME/Applications/MidiTutor.app\" \
  --args --user-data-dir=$UD --remote-debugging-port=$CDP_REMOTE --mute-audio"
for ((i=0; i<60; i++)); do
  remote "cat $UD/api-token 2>/dev/null" > "$scratch/token" || true
  [[ -s "$scratch/token" ]] && break
  sleep 1
done
[[ -s "$scratch/token" ]] || { echo 'Test copy never wrote its api-token.'; exit 7; }

ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -L "$API_PORT:127.0.0.1:$API_PORT" -L "$CDP_LOCAL:127.0.0.1:$CDP_REMOTE" "$H" &
tunnel_pid=$!
for ((i=0; i<30; i++)); do
  curl -s --max-time 2 -H "Authorization: Bearer $(tr -d '[:space:]' < "$scratch/token")" \
    "http://127.0.0.1:$API_PORT/state" | grep -q '"ok":true' && break
  sleep 1
done

MIDITUTOR_URL="http://127.0.0.1:$API_PORT" MIDITUTOR_TOKEN_FILE="$scratch/token" \
  MIDITUTOR_CDP="http://127.0.0.1:$CDP_LOCAL" python "$here/e2e_tutor.py" --cdp-out 'IAC Driver Bus 1'
