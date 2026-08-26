#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/matheus/projects/envsync"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PATH="$HOME/.local/share/pnpm:$HOME/.nvm/versions/node/v24.18.0/bin:/usr/local/bin:/usr/bin:$PATH"

cd "$ROOT"

# Garante UI buildada (servida pelo daemon em :45770)
if [[ ! -f apps/ui/dist/index.html ]]; then
  pnpm --filter @envsync/ui build
fi

exec python3 "$ROOT/apps/desktop/envsync-desktop-qt.py"
