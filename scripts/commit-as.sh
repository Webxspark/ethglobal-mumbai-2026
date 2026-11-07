#!/usr/bin/env bash
# Commit a set of paths under one contributor's real identity.
#
# Usage:
#   ./scripts/commit-as.sh <author> "<message>" <path> [<path>...]
#   ./scripts/commit-as.sh <author> "<message>" <path> --preview
#
# This exists because attribution has to match reality: whoever wrote a file
# commits that file, under their own name, at the time they actually commit it.
# It will not backdate anything or accept paths that look like credentials.
#
# Exit codes: 0 ok, 1 usage/guard failure, 2 nothing to commit.

set -euo pipefail

usage() {
  awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
  exit 1
}

[ $# -ge 3 ] || usage

author_key="$1"
shift
message="$1"
shift

preview=0
paths=()
for arg in "$@"; do
  case "$arg" in
    --preview) preview=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *) paths+=("$arg") ;;
  esac
done

[ ${#paths[@]} -gt 0 ] || { echo "no paths given" >&2; exit 1; }

case "$author_key" in
  allan)     name="Allan Christofer" ;;
  mary)      name="Mary Judity Sylvia" ;;
  jayna)     name="Jayna Mukesh" ;;
  mukeshwar) name="Mukeshwar R M" ;;
  *) echo "unknown author '$author_key' (try: allan, mary, jayna, mukeshwar)" >&2; exit 1 ;;
esac

case "$author_key" in
  allan)     email="alanchris@webxspark.com" ;;
  mary)      email="mary@webxspark.com" ;;
  jayna)     email="jayna@webxspark.com" ;;
  mukeshwar) email="mukeshwar.1010@gmail.com" ;;
esac

cd "$(git rev-parse --show-toplevel)"

# Stage the requested paths.
git add -- "${paths[@]}"

staged=$(git diff --cached --name-only)
if [ -z "$staged" ]; then
  echo "nothing staged for: ${paths[*]}" >&2
  exit 2
fi

# Hard stop on anything that looks like a secret or local-only state.
bad=$(printf '%s\n' "$staged" | grep -E '(^|/)\.env(\.|$)|\.pem$|\.key$|(^|/)id_(rsa|ed25519)$|(^|/)\.agents/' | grep -vE '\.env\.example$' || true)
if [ -n "$bad" ]; then
  echo "refusing to commit credential-shaped or local-only paths:" >&2
  printf '  %s\n' $bad >&2
  git reset -q -- "${paths[@]}" 2>/dev/null || true
  exit 1
fi

if git diff --cached -U0 | grep -qE 'ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'; then
  echo "refusing to commit: staged content contains a live credential" >&2
  git reset -q -- "${paths[@]}" 2>/dev/null || true
  exit 1
fi

echo "author : $name <$email>"
echo "message: $message"
echo "files  :"
printf '  %s\n' $staged

if [ "$preview" -eq 1 ]; then
  echo "(preview only, nothing committed)"
  exit 0
fi

git -c user.name="$name" -c user.email="$email" \
    commit -q --author="$name <$email>" -m "$message"

echo
git --no-pager log -1 --format='committed %h as %an <%ae> — %s'
