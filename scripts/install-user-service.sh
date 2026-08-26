#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/packaging/systemd/envsyncd.service"
UNIT_DST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/envsyncd.service"

mkdir -p "$(dirname "$UNIT_DST")"
# Rewrite ExecStart to this checkout
sed "s|%h/projects/envsync|$ROOT|g" "$UNIT_SRC" > "$UNIT_DST"
# Prefer absolute node
NODE_BIN="$(command -v node)"
sed -i "s|/usr/bin/env node|$NODE_BIN|g" "$UNIT_DST"

systemctl --user daemon-reload
systemctl --user enable --now envsyncd.service
systemctl --user status envsyncd.service --no-pager
