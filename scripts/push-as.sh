#!/usr/bin/env bash
# Push to the shared remote using a token supplied in the environment.
#
# Usage:
#   GITHUB_TOKEN=<your own PAT> ./scripts/push-as.sh
#
# The token is handed to git through GIT_ASKPASS, so it never appears in the
# process list, the remote URL, .git/config, or shell history. Each teammate
# uses their own token; nothing is shared or stored.
#
# Requires a fine-grained or classic PAT with `contents: write` on
# Webxspark/testing-repo.

set -euo pipefail

: "${GITHUB_TOKEN:?set GITHUB_TOKEN to your own personal access token}"

cd "$(git rev-parse --show-toplevel)"

branch="${1:-main}"
remote="https://github.com/Webxspark/testing-repo.git"

askpass="$(git rev-parse --git-dir)/askpass.sh"
cat > "$askpass" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *sername*) printf '%s\n' "x-access-token" ;;
  *)         printf '%s\n' "$GITHUB_TOKEN" ;;
esac
EOF
chmod 700 "$askpass"
trap 'rm -f "$askpass"' EXIT

GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 \
  git push "$remote" "HEAD:$branch"
