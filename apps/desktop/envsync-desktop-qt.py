#!/usr/bin/env python3
"""EnvSync desktop shell — PySide6 + QtWebEngine (mesmo padrão do Hermes)."""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PySide6.QtCore import QSettings, QUrl
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QWidget
from PySide6.QtWebEngineWidgets import QWebEngineView

ROOT = Path("/home/matheus/projects/envsync")
URL = os.environ.get("ENVSYNC_URL", "http://127.0.0.1:45770")
ICON_CANDIDATES = [
    Path.home() / ".local/share/icons/envsync.png",
    Path.home() / ".local/share/icons/hicolor/128x128/apps/envsync.png",
    ROOT / "packaging/icons/png/envsync-128.png",
]


def resolve_icon() -> QIcon:
    icon = QIcon()
    home_icons = Path.home() / ".local/share/icons/hicolor"
    for size in (16, 22, 24, 32, 48, 64, 128, 256, 512):
        path = home_icons / f"{size}x{size}/apps/envsync.png"
        if path.exists():
            icon.addFile(str(path))
    for path in ICON_CANDIDATES:
        if path.exists():
            icon.addFile(str(path))
            break
    return icon


def ensure_path() -> None:
    home = Path.home()
    extras = [
        home / ".local/share/pnpm",
        home / ".nvm/versions/node/v24.18.0/bin",
        Path("/usr/local/bin"),
    ]
    parts = os.environ.get("PATH", "").split(":")
    for extra in extras:
        value = str(extra)
        if value not in parts:
            parts.insert(0, value)
    os.environ["PATH"] = ":".join(parts)


def health_ok() -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/health", timeout=1) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


def start_backend() -> None:
    if health_ok():
        return

    ensure_path()
    log = Path("/tmp/envsync-daemon.log")
    with log.open("ab") as handle:
        subprocess.Popen(
            ["pnpm", "daemon"],
            cwd=str(ROOT),
            stdout=handle,
            stderr=handle,
            start_new_session=True,
        )

    for _ in range(40):
        if health_ok():
            return
        time.sleep(0.25)

    raise RuntimeError(
        "Daemon EnvSync não respondeu em /health. Veja /tmp/envsync-daemon.log"
    )


class EnvSyncWindow(QMainWindow):
    def __init__(self, url: str, icon: QIcon) -> None:
        super().__init__()
        self.setWindowTitle("EnvSync")
        self.setWindowIcon(icon)

        self.browser = QWebEngineView(self)
        self.browser.setUrl(QUrl(url))

        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.browser)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        self.settings = QSettings("EnvSync", "EnvSyncDesktop")
        geometry = self.settings.value("geometry")
        if geometry:
            self.restoreGeometry(geometry)
        else:
            self.resize(1180, 760)

        state = self.settings.value("windowState")
        if state:
            self.restoreState(state)

    def closeEvent(self, event) -> None:  # noqa: N802
        self.settings.setValue("geometry", self.saveGeometry())
        self.settings.setValue("windowState", self.saveState())
        super().closeEvent(event)


def main() -> int:
    # Ajuda o Plasma a casar com envsync.desktop / StartupWMClass=envsync
    sys.argv[0] = "envsync"
    start_backend()

    QGuiApplication.setApplicationName("envsync")
    QGuiApplication.setApplicationDisplayName("EnvSync")
    QGuiApplication.setDesktopFileName("envsync")

    app = QApplication(sys.argv)
    app.setApplicationName("envsync")
    app.setApplicationDisplayName("EnvSync")
    app.setDesktopFileName("envsync")

    icon = resolve_icon()
    app.setWindowIcon(icon)

    window = EnvSyncWindow(URL, icon)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
