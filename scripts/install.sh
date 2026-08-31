#!/usr/bin/env bash
# Instala EnvSync no usuário atual: deps, build, ícone e atalho no menu.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.local/share/pnpm:${HOME}/.nvm/versions/node/v24.18.0/bin:/usr/local/bin:/usr/bin:${PATH}"

echo "==> EnvSync install em: $ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Falta: $1" >&2
    return 1
  fi
}

if ! need node; then
  echo "Instale Node.js (nvm ou pacman) e rode de novo." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> Instalando pnpm..."
  corepack enable >/dev/null 2>&1 || true
  npm install -g pnpm@9
fi

if ! python3 -c "from PySide6.QtWebEngineWidgets import QWebEngineView" 2>/dev/null; then
  echo "==> PySide6/QtWebEngine não encontrado."
  echo "    BigLinux/Manjaro/Arch: sudo pacman -S python-pyside6"
  echo "    Depois rode novamente: ./scripts/install.sh"
  exit 1
fi

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Aviso: rsvg-convert ausente; tentando usar PNG já versionado."
fi

echo "==> pnpm install"
pnpm install

echo "==> build packages + daemon + UI"
pnpm --filter @envsync/protocol build
pnpm --filter @envsync/catalog build
pnpm --filter @envsync/core build
pnpm --filter @envsync/plugins build
pnpm --filter @envsync/daemon build
pnpm --filter @envsync/ui build

echo "==> ícones"
ICON_DIR="${HOME}/.local/share/icons/hicolor"
SVG="${ROOT}/packaging/icons/envsync.svg"
mkdir -p "${HOME}/.local/share/icons" "$ICON_DIR/scalable/apps"
if [[ -f "$SVG" ]] && command -v rsvg-convert >/dev/null 2>&1; then
  cp "$SVG" "$ICON_DIR/scalable/apps/envsync.svg"
  for size in 16 22 24 32 48 64 128 256 512; do
    mkdir -p "$ICON_DIR/${size}x${size}/apps"
    rsvg-convert -w "$size" -h "$size" "$SVG" -o "$ICON_DIR/${size}x${size}/apps/envsync.png"
  done
  cp "$ICON_DIR/512x512/apps/envsync.png" "${HOME}/.local/share/icons/envsync.png"
elif [[ -f "${ROOT}/packaging/icons/png/envsync-128.png" ]]; then
  for size in 16 32 48 64 128 256; do
    mkdir -p "$ICON_DIR/${size}x${size}/apps"
    cp "${ROOT}/packaging/icons/png/envsync-128.png" "$ICON_DIR/${size}x${size}/apps/envsync.png"
  done
  cp "${ROOT}/packaging/icons/png/envsync-128.png" "${HOME}/.local/share/icons/envsync.png"
else
  echo "Aviso: nenhum ícone encontrado em packaging/icons" >&2
fi
gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true

echo "==> atalho do menu"
mkdir -p "${HOME}/.local/share/applications"
DESKTOP="${HOME}/.local/share/applications/envsync.desktop"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=EnvSync
GenericName=Environment Sync
Comment=Sincronização seletiva de ambiente entre dispositivos na LAN
Exec=${ROOT}/scripts/launch-envsync.sh
Icon=envsync
Terminal=false
Categories=Utility;
Keywords=sync;ambiente;biglinux;lan;config;
StartupNotify=true
StartupWMClass=envsync
EOF

chmod +x "${ROOT}/scripts/launch-envsync.sh" "${ROOT}/scripts/ensure-daemon.sh" "${ROOT}/apps/desktop/envsync-desktop-qt.py" "${ROOT}/scripts/install.sh"
update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null || true

if [[ "${ENVSYNC_INSTALL_SERVICE:-0}" == "1" ]]; then
  echo "==> serviço systemd user"
  "${ROOT}/scripts/install-user-service.sh"
fi

echo
echo "Instalação concluída."
echo "Abra pelo menu: EnvSync"
echo "Ou rode: ${ROOT}/scripts/launch-envsync.sh"
echo "Opcional (daemon sempre ativo): ENVSYNC_INSTALL_SERVICE=1 ./scripts/install.sh"
