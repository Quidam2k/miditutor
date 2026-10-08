# Pinocchio SSH runbook for Orolo

Orolo drives the Mac mini **Pinocchio** over SSH from the Windows box **Solace**. Todd has completed [the physical setup](pinocchio-todd-steps.md) and enabled Remote Login.

All procedures below are [NOT VERIFIED] on the real machine. Use Git Bash on Solace for the Bash commands. Sections 2–10 run in the SSH Bash session on Pinocchio. Sections 11–12 run in separate Git Bash terminals on Solace.

The app window and MIDI require Todd's logged-in Aqua session. Keep Todd logged in throughout setup and verification.

## 1. Confirm SSH from Solace [NOT VERIFIED]

Add this suggested Host block to Solace's `~/.ssh/config`. Replace `TODD_SHORT_NAME` with the account short name Todd supplies. Use Pinocchio's IP address if `pinocchio.local` does not resolve. Uncomment `IdentityFile` if using that key.

```bash
mkdir -p ~/.ssh
cat >> ~/.ssh/config <<'SSH_CONFIG'
Host pinocchio
    HostName pinocchio.local
    User TODD_SHORT_NAME
    # IdentityFile ~/.ssh/id_ed25519
SSH_CONFIG
```

Test connectivity. If installing an existing public key, `ssh-copy-id` needs Todd's Mac password once.

```bash
ssh pinocchio 'sw_vers -productVersion; uname -m'
# Optional, when using this existing key:
ssh-copy-id -i ~/.ssh/id_ed25519.pub pinocchio
```

Verify: SSH succeeds; macOS reports `15.x` and the architecture reports `arm64`.

## 2. Check Xcode Command Line Tools [NOT VERIFIED]

```bash
xcode-select -p
git --version
# Only if Command Line Tools are missing:
xcode-select --install
```

The installer opens a GUI dialog. **Todd must click through it on Pinocchio.** Wait for completion, then rerun the checks once; do not loop on the installer.

Verify: `xcode-select -p` returns a developer directory and `git --version` succeeds.

## 3. Install Homebrew [NOT VERIFIED]

Check first. Install only if Homebrew is missing. Installation needs completed Command Line Tools and sudo access. Enter the password interactively; never put it in a file.

```bash
command -v brew
# Only if Homebrew is missing:
sudo -v
NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Apple Silicon Homebrew lives under `/opt/homebrew`. Add its environment setup to `~/.zprofile` and apply it in this session.

```bash
touch "$HOME/.zprofile"
grep -Fqx 'eval "$(/opt/homebrew/bin/brew shellenv)"' "$HOME/.zprofile" ||
  printf '%s\n' 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
eval "$(/opt/homebrew/bin/brew shellenv)"
brew --prefix
```

`.zprofile` applies to login zsh sessions. Plain non-interactive SSH commands do not automatically read it; explicitly run `eval "$(/opt/homebrew/bin/brew shellenv)"` when those commands need Homebrew.

Verify: `brew --prefix` prints `/opt/homebrew`.

## 4. Install Node 22 [NOT VERIFIED]

`node@22` is keg-only. Put its executable directory first on PATH, both persistently for login zsh and in the current Bash session.

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
brew install node@22
grep -Fqx 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' "$HOME/.zprofile" ||
  printf '%s\n' 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> "$HOME/.zprofile"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v
npm -v
command -v node
```

Verify: Node reports `v22.x.x`; its path is `/opt/homebrew/opt/node@22/bin/node`.

## 5. Clone the repository [NOT VERIFIED]

If `~/src/miditutor` already exists, inspect it before reusing it; skip the clone and preserve any local work.

```bash
mkdir -p ~/src
git clone https://github.com/Quidam2k/miditutor ~/src/miditutor
cd ~/src/miditutor
git checkout master
git remote -v
git branch --show-current
```

Verify: The origin is `https://github.com/Quidam2k/miditutor` and the current branch is `master`.

## 6. Install dependencies and build [NOT VERIFIED]

The app uses Electron Forge, Vite, Electron 41, and Node 22. Stop and resolve a failure before continuing to the next command.

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd ~/src/miditutor
npm ci &&
  npx tsc --noEmit &&
  npx vitest run &&
  npx electron-forge make --platform=darwin --arch=arm64
ls -ld out/MidiTutor-darwin-arm64/MidiTutor.app
ls -l out/make/zip/darwin/arm64/
```

Verify: Installation, type checking, tests, and packaging succeed. The `.app` exists at `out/MidiTutor-darwin-arm64/MidiTutor.app`; MakerZIP produces a zip under `out/make/zip/darwin/arm64/`.

## 7. Install the app [NOT VERIFIED]

Quit any running MidiTutor instance before replacing it. Use `ditto` to preserve the app bundle.

```bash
cd ~/src/miditutor
sudo ditto out/MidiTutor-darwin-arm64/MidiTutor.app /Applications/MidiTutor.app
test -x /Applications/MidiTutor.app/Contents/MacOS/MidiTutor
```

If the bundle came from a downloaded zip, remove its quarantine attribute. This is unnecessary for a locally built app with no quarantine attribute.

```bash
sudo xattr -dr com.apple.quarantine /Applications/MidiTutor.app
```

The app is unsigned. Gatekeeper may still block first launch. **Todd must use System Settings → Privacy & Security → Open Anyway** if prompted.

Verify: `/Applications/MidiTutor.app/Contents/MacOS/MidiTutor` exists and is executable; Todd resolves any Gatekeeper block.

## 8. Launch into Todd's GUI session [NOT VERIFIED]

Run this while SSH is logged in as Todd's Mac account.

```bash
launchctl asuser "$(id -u)" open -a /Applications/MidiTutor.app
pgrep -fl MidiTutor
```

A plain SSH session cannot show windows. `launchctl asuser` targets the user's session; it does not create an Aqua session. Todd must already be logged into the Mac desktop for the window and MIDI to work.

Verify: Todd sees the MidiTutor window, and `pgrep` shows the app running. A process alone does not prove the GUI is connected.

## 9. Launch at login [NOT VERIFIED]

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
        <string>/Applications/MidiTutor.app/Contents/MacOS/MidiTutor</string>
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

## 10. Keep Pinocchio awake [NOT VERIFIED]

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

## 11. Tunnel from Solace [NOT VERIFIED]

Run in a separate Solace Git Bash terminal and keep it running. The explicit local address limits the forward to loopback. Never bind port 47800 on the LAN, and do not set `MIDITUTOR_PORT` on the Mac. If the dev MidiTutor app is running on Solace, it already holds local port 47800, so the forward fails with ExitOnForwardFailure; stop the dev app first or use another local port.

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:47800:127.0.0.1:47800 pinocchio
```

Verify: SSH remains running without forwarding errors; section 13 confirms the forwarded API responds.

## 12. Fetch and store the token on Solace [NOT VERIFIED]

The first app launch creates `$HOME/Library/Application Support/MidiTutor/api-token` on Pinocchio. Capture it without printing it. Keep tracing disabled, never commit it, and never echo it into logs.

```bash
set +x
MIDITUTOR_TOKEN="$(ssh pinocchio 'cat "$HOME/Library/Application Support/MidiTutor/api-token"')"
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
launchctl asuser "$(id -u)" /usr/bin/osascript -e 'tell application "MidiTutor" to quit' &&
  rm -f "$HOME/Library/Application Support/MidiTutor/api-token" &&
  launchctl asuser "$(id -u)" open -a /Applications/MidiTutor.app
```

Verify: The selected token variable or file is populated without displaying its contents; authenticated requests succeed in section 13.

## 13. Verify end to end [NOT VERIFIED]

On Pinocchio:

```bash
set +x
curl -s -H "Authorization: Bearer $(cat "$HOME/Library/Application Support/MidiTutor/api-token")" http://127.0.0.1:47800/state
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:47800/state
```

On Solace, with the tunnel running and section 12's environment available:

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

## 14. Troubleshooting [NOT VERIFIED]

- **MIDI device not seen:** Check the hub and FP-30X Computer port. Unplug and replug USB; keep Local Control **ON**.
- **MIDI absent in the app:** Inspect `device` fields in `/state`; ensure the window is in Todd's GUI session.
- **App not frontmost:** Activate it with AppleScript; this requires the GUI session.
- **401:** The token mismatches. Refetch it and update or restart the MCP session.
- **Connection refused on 47800:** Check that the tunnel is running and the app process exists.
- **Gatekeeper blocks launch:** Todd uses **Open Anyway** in Privacy & Security.
- **Mac sleeping:** Inspect `pmset`; restore the awake settings or run `caffeinate`.
- **`npm ci` fails:** Confirm Command Line Tools and Node 22, then inspect the installation error.

Run the relevant checks on Pinocchio:

```bash
system_profiler SPUSBDataType | grep -i roland
curl -s -H "Authorization: Bearer $(cat "$HOME/Library/Application Support/MidiTutor/api-token")" http://127.0.0.1:47800/state
osascript -e 'tell application "MidiTutor" to activate'
pgrep -fl MidiTutor
pmset -g | grep -E 'sleep|autorestart'
xcode-select -p
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v
```

Verify: The relevant check identifies the fault; rerun section 13 after correcting it.

Verified on hardware: none yet. Everything marked NOT VERIFIED is untested.
