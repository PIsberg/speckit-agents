#!/usr/bin/env sh
# macOS, Linux, Git Bash. Checks for Node, then hands every argument to install.mjs.
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node 18+ (https://nodejs.org); the hooks run on it." >&2
  exit 1
fi
exec node "$(dirname "$0")/install.mjs" "$@"
