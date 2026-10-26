# Pinocchio SSH runbook for Orolo

Orolo drives the Mac mini **Pinocchio** over SSH from the Windows box **Solace**.

## Facts (verified 2026-10-25)

- `ssh toddwalker@todds-mac-mini` works from Solace by key (Tailscale, 100.106.20.55). No password.
- Apple M2, 8 GB RAM, macOS **14.4 Sonoma**, arm64. Account short name `toddwalker`.
- Auto-login is ON (Todd set it 2026-10-25). `sleep 0` is already set. Firewall off.
- **No Xcode Command Line Tools, no Node, no Homebrew.** `/usr/bin/git`, `/usr/bin/python3`,
  `cc`, `make` are CLT shims: running one pops an "install developer tools" dialog on the
  TV. Never call them on Pinocchio. Use only sh/bash (3.2), ditto, xattr, codesign,
  osascript, open, pgrep, pkill, curl, defaults, plutil.
- `launchctl asuser` needs root and fails from Todd's SSH session
  ("Could not switch to audit session"). Plain `open` and `osascript` from SSH reach his
  logged-in desktop fine.

## 1. Build and install (verified 2026-10-25)

The app is built on GitHub Actions (`.github/workflows/macos.yml`, macos-14 arm64), not on
the Mac. From the repo on Solace, in Git Bash:

```bash
gh workflow run macos.yml --ref master      # ~3 min; skip if master hasn't changed
bash scripts/deploy_pinocchio.sh            # latest green run -> scp -> ~/Applications -> hidden check
```

The deploy script quits a running MidiTutor, replaces `~/Applications/MidiTutor.app`
(no sudo), then launches it hidden (`open -n -g -j --env MIDITUTOR_HIDDEN=1`), checks
`/state` is 200 with the token (renderer connected, Web MIDI enabled) and 401 without,
and quits it again. It never prints the token. `--no-verify` skips the check.

The bundle is ad-hoc signed and copied by scp, so it has no quarantine flag and
Gatekeeper does not prompt. If it ever does: Todd opens System Settings > Privacy &
Security, scrolls down, clicks **Open Anyway** next to MidiTutor.

## 2. Launch icon (done 2026-10-25)

MidiTutor is in Todd's Dock (`defaults write com.apple.dock persistent-apps -array-add ...`
then `killall Dock`), plus a `~/Desktop/MidiTutor` symlink. Don't use Finder AppleScript
for aliases: it pops an automation permission prompt on the TV.

To launch it for Todd from SSH: `open -a "$HOME/Applications/MidiTutor.app"` (shows the window on the TV).

## 3. Launch at login (optional, not set up) [NOT VERIFIED]

Auto-login is now ON, so this would start MidiTutor at boot. Not installed: Todd launches it from the Dock. Ask before adding it.

The heredoc expands `$HOME` into absolute paths: launchd does not expand `~` in plist values. Quit the manually launched app before bootstrapping this agent.

```bash
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$HOME/Library/LaunchAgents/com.todd.miditutor.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.todd.miditutor</string>
    <key>ProgramArguments</key>
    <array>
        <string>$HOME/Applications/MidiTutor.app/Contents/MacOS/MidiTutor</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/miditutor.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/miditutor.log</string>
</dict>
</plist>
PLIST
plutil -lint "$HOME/Library/LaunchAgents/com.todd.miditutor.plist"
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.todd.miditutor.plist
launchctl print gui/$(id -u)/com.todd.miditutor
# To unload:
# launchctl bootout gui/$(id -u)/com.todd.miditutor
```

A LaunchAgent runs only while Todd is logged in. Automatic unattended startup after reboot requires Todd's GUI login, so auto-login is needed for that behavior. `KeepAlive` is false: the agent does not restart an app that exits.

Verify: The plist passes validation, launchctl reports the agent, and MidiTutor opens in Todd's desktop session.

## 4. Keep Pinocchio awake [NOT VERIFIED]

Inspect settings first. Disable system sleep with `pmset`, or leave that setting to Todd's Energy configuration. Enable automatic restart after power loss. Keep the SSH session open while using the `caffeinate` guard.

```bash
pmset -g
sudo pmset -a sleep 0
sudo pmset -a autorestart 1
pmset -g | grep -E 'sleep|autorestart'
caffeinate -dimsu
```

`caffeinate` runs in the foreground; Ctrl-C ends the guard.

Verify: `pmset` reports `sleep 0` and `autorestart 1`, and Pinocchio stays awake during use.

## 5. Tunnel from Solace [VERIFIED 2026-10-25, #9443]

Run in a separate Solace Git Bash terminal and keep it running. The explicit local address limits the forward to loopback. Never bind port 47800 on the LAN, and do not set `MIDITUTOR_PORT` on the Mac. If the dev MidiTutor app is running on Solace, it already holds local port 47800, so the forward fails with ExitOnForwardFailure; stop the dev app first or use another local port.

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:47800:127.0.0.1:47800 toddwalker@todds-mac-mini
```

Verify: SSH remains running without forwarding errors; section 7 confirms the forwarded API responds.

**LAN fallback (2026-10-25, #9478):** after a Pinocchio reboot, Tailscale TCP can stay dead (100.106.20.55:22 refused). Use the LAN address instead. The user is `toddwalker`, not `todd`:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:47800:127.0.0.1:47800 toddwalker@192.168.50.27
```

Only one tunnel can hold local port 47800. If another session already has it, leave that tunnel alone and forward a different local port (e.g. `-L 127.0.0.1:47801:127.0.0.1:47800`), then point your client at 47801.

## 6. Fetch and store the token on Solace [VERIFIED 2026-10-25, #9443: MIDITUTOR_TOKEN_FILE route]

The first app launch creates `$HOME/Library/Application Support/MidiTutor/api-token` on Pinocchio. Capture it without printing it. Keep tracing disabled, never commit it, and never echo it into logs.

```bash
set +x
MIDITUTOR_TOKEN="$(ssh toddwalker@todds-mac-mini 'cat "$HOME/Library/Application Support/MidiTutor/api-token"')"
test -n "$MIDITUTOR_TOKEN"
export MIDITUTOR_TOKEN
export MIDITUTOR_URL="http://127.0.0.1:47800"
```

Start the MCP server from this same shell so it inherits the variables. Alternatively, store the token outside every repository and configure `MIDITUTOR_TOKEN_FILE`:

```bash
umask 077
mkdir -p "$HOME/.config/miditutor"
printf '%s' "$MIDITUTOR_TOKEN" > "$HOME/.config/miditutor/api-token"
export MIDITUTOR_TOKEN_FILE="$HOME/.config/miditutor/api-token"
unset MIDITUTOR_TOKEN
```

`miditutor_mcp/tutor_client.py` gives `MIDITUTOR_TOKEN` precedence over the file. On Solace, set `MIDITUTOR_TOKEN_FILE` or `MIDITUTOR_TOKEN` explicitly; the default path there is the Windows one (`%APPDATA%\MidiTutor\api-token`), not the Mac path.

To rotate, quit the app, delete its Mac token file, and relaunch. Run on Pinocchio, then fetch the new token and restart the MCP session:

```bash
osascript -e 'tell application "MidiTutor" to quit' &&
  rm -f "$HOME/Library/Application Support/MidiTutor/api-token" &&
  open -a "$HOME/Applications/MidiTutor.app"
```

Verify: The selected token variable or file is populated without displaying its contents; authenticated requests succeed in section 7.

## 7. Verify end to end [VERIFIED 2026-10-25, #9443: 200 with token, 401 without, POST /piece + /screenshot]

On Pinocchio:

```bash
set +x
curl -s -H "Authorization: Bearer $(cat "$HOME/Library/Application Support/MidiTutor/api-token")" http://127.0.0.1:47800/state
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:47800/state
```

On Solace, with the tunnel running and section 6's environment available:

```bash
set +x
token="${MIDITUTOR_TOKEN:-}"
if [ -z "$token" ]; then
  token="$(cat "$MIDITUTOR_TOKEN_FILE")"
fi
curl -s -H "Authorization: Bearer $token" http://127.0.0.1:47800/state
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:47800/state
unset token
```

Verify: Both authenticated responses contain `"ok": true`, `device`, and `"injectEnabled": false` for the packaged app. Expect `"rendererConnected": true` within about 30 seconds of the window appearing. Requests without the authorization header return `401`.

## 8. Troubleshooting [NOT VERIFIED]

- **MIDI device not seen:** Check the hub and FP-30X Computer port. Unplug and replug USB; keep Local Control **ON**.
- **MIDI absent in the app:** Inspect `device` fields in `/state`; ensure the window is in Todd's GUI session.
- **App not frontmost:** Activate it with AppleScript; this requires the GUI session.
- **401:** The token mismatches. Refetch it and update or restart the MCP session.
- **Connection refused on 47800:** Check that the tunnel is running and the app process exists.
- **Gatekeeper blocks launch:** Todd uses **Open Anyway** in Privacy & Security.
- **Mac sleeping:** Inspect `pmset`; restore the awake settings or run `caffeinate`.

Run the relevant checks on Pinocchio:

```bash
system_profiler SPUSBDataType | grep -i roland
curl -s -H "Authorization: Bearer $(cat "$HOME/Library/Application Support/MidiTutor/api-token")" http://127.0.0.1:47800/state
osascript -e 'tell application "MidiTutor" to activate'
pgrep -fl MidiTutor
pmset -g | grep -E 'sleep|autorestart'
```

Verify: The relevant check identifies the fault; rerun section 7 after correcting it.

Verified on hardware 2026-10-25: sections 1-2 (build, install, hidden /state check, Dock icon). Everything marked NOT VERIFIED is untested. The FP-30X has not been plugged in yet.
