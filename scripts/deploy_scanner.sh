#!/usr/bin/env bash
# Install the CI-built SANE scanimage bundle on Pinocchio (no Homebrew, CLT or sudo on the Mac).
# Never call git/python3/cc on the Mac: without Xcode CLT they pop an install dialog on the TV.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/deploy_scanner.sh [--help]
Install the latest successful scanner-macos.yml build to ~/Applications/sane and run scanimage -L.
Environment:
  PINOCCHIO_HOST  SSH destination (default: toddwalker@todds-mac-mini)
  RUN_ID         GitHub Actions run ID (default: latest successful scanner-macos.yml)
USAGE
}
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  "") ;;
  *) usage >&2; exit 2 ;;
esac

PINOCCHIO_HOST=${PINOCCHIO_HOST:-toddwalker@todds-mac-mini}
RUN_ID=${RUN_ID:-$(gh run list --workflow scanner-macos.yml --status success -L 1 --json databaseId -q '.[0].databaseId')}
[[ -n "$RUN_ID" && "$RUN_ID" != null ]] || { echo "No successful run found." >&2; exit 1; }
tmpdir=$(mktemp -d)
trap 'rm -rf -- "$tmpdir"' EXIT
gh run download "$RUN_ID" -n sane-fujitsu-macos-arm64 -D "$tmpdir"
tarball="$tmpdir/sane-fujitsu-macos-arm64.tar.gz"
test -s "$tarball"
scp "$tarball" "${PINOCCHIO_HOST}:sane-deploy.tar.gz"

ssh "$PINOCCHIO_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
# The bundle's paths are compiled for this exact prefix.
test "$HOME" = /Users/toddwalker
mkdir -p "$HOME/Applications" "$HOME/Scans/inbox"
rm -rf "$HOME/Applications/sane"
tar -xzf "$HOME/sane-deploy.tar.gz" -C "$HOME/Applications"
rm "$HOME/sane-deploy.tar.gz"
xattr -dr com.apple.quarantine "$HOME/Applications/sane" 2>/dev/null || true
"$HOME/Applications/sane/bin/scanimage" --version
"$HOME/Applications/sane/bin/scanimage" -L
REMOTE
printf 'PASS: SANE scanimage deployed to %s\n' "$PINOCCHIO_HOST"
