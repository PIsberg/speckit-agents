#!/usr/bin/env sh
# macOS, Linux, Git Bash. Checks for Node 18 or newer, then hands every argument to install.mjs.
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node 18+ (https://nodejs.org); the hooks run on it." >&2
  exit 1
fi
version=$(node --version 2>/dev/null || true)
major=$(printf '%s' "$version" | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p')
if [ -z "$major" ] || [ "$major" -lt 18 ]; then
  echo "ERROR: Node 18 or newer is needed; found ${version:-no version from node --version}. Install it (https://nodejs.org); the hooks run on it." >&2
  exit 1
fi
exec node "$(dirname "$0")/install.mjs" "$@"
