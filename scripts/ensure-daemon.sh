#!/usr/bin/env bash
# Garante que o daemon EnvSync está online antes de abrir a UI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${ENVSYNC_URL:-http://127.0.0.1:45770}"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PATH="${HOME}/.local/share/pnpm:${HOME}/.nvm/versions/node/v24.18.0/bin:/usr/local/bin:/usr/bin:${PATH}"

health_ok() {
  curl -sf --max-time 1 "${URL}/health" >/dev/null 2>&1
}

if health_ok; then
  exit 0
fi

UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/envsyncd.service"
if [[ -f "$UNIT" ]]; then
  systemctl --user start envsyncd.service 2>/dev/null || true
  for _ in $(seq 1 40); do
    health_ok && exit 0
    sleep 0.25
  done
fi

LOG="/tmp/envsync-daemon.log"
NODE_BIN="$(command -v node || true)"
DAEMON_JS="${ROOT}/apps/daemon/dist/main.js"

if [[ -n "$NODE_BIN" && -f "$DAEMON_JS" ]]; then
  nohup "$NODE_BIN" "$DAEMON_JS" >>"$LOG" 2>&1 &
elif command -v pnpm >/dev/null 2>&1; then
  cd "$ROOT"
  nohup pnpm daemon >>"$LOG" 2>&1 &
else
  echo "EnvSync: node ou pnpm não encontrado. Rode ./scripts/install.sh" >&2
  exit 1
fi

for _ in $(seq 1 40); do
  health_ok && exit 0
  sleep 0.25
done

echo "EnvSync: daemon não respondeu. Veja $LOG" >&2
exit 1
