#!/usr/bin/env python3
"""EnvSync desktop shell — PySide6 + QtWebEngine + system tray."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PySide6.QtCore import QObject, QSettings, QTimer, QUrl, QUrlQuery, Slot
from PySide6.QtGui import QAction, QGuiApplication, QIcon
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineScript, QWebEngineUrlScheme
from PySide6.QtWebEngineWidgets import QWebEngineView

from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QMainWindow,
    QMenu,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)

ROOT = Path(__file__).resolve().parents[2]
URL = os.environ.get("ENVSYNC_URL", "http://127.0.0.1:45770")
WEBCHANNEL_BOOTSTRAP = """
(function () {
  if (window.__envsyncChannelBootstrapped) return;
  window.__envsyncChannelBootstrapped = true;

  function attachChannel() {
    if (typeof QWebChannel === "undefined" || typeof qt === "undefined") return;
    new QWebChannel(qt.webChannelTransport, function (channel) {
      window.envsyncDesktop = channel.objects.envsync;
      window.__ENVSYNC_DESKTOP__ = true;
    });
  }

  var script = document.createElement("script");
  script.src = "qrc:///qtwebchannel/qwebchannel.js";
  script.onload = attachChannel;
  script.onerror = function () {
    window.__ENVSYNC_DESKTOP__ = true;
  };
  document.head.appendChild(script);
})();
"""
_CHANNEL_SCRIPT_INSTALLED = False
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


def rpc(method: str, params: dict | None = None) -> dict:
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": method,
        "params": params or {},
    }
    request = urllib.request.Request(
        f"{URL}/rpc",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=3) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("error"):
        raise RuntimeError(body["error"].get("message", "RPC error"))
    return body.get("result") or {}


def start_backend() -> None:
    if health_ok():
        return

    ensure_path()
    log = Path("/tmp/envsync-daemon.log")
    unit = Path.home() / ".config/systemd/user/envsyncd.service"
    if unit.exists():
        subprocess.run(
            ["systemctl", "--user", "start", "envsyncd.service"],
            check=False,
            capture_output=True,
        )
        for _ in range(40):
            if health_ok():
                return
            time.sleep(0.25)

    node = shutil.which("node")
    daemon_js = ROOT / "apps/daemon/dist/main.js"
    daemon_env = os.environ.copy()
    daemon_env.setdefault("DISPLAY", ":0")
    with log.open("ab") as handle:
        if node and daemon_js.exists():
            subprocess.Popen(
                [node, str(daemon_js)],
                cwd=str(ROOT),
                stdout=handle,
                stderr=handle,
                start_new_session=True,
                env=daemon_env,
            )
        else:
            subprocess.Popen(
                ["pnpm", "daemon"],
                cwd=str(ROOT),
                stdout=handle,
                stderr=handle,
                start_new_session=True,
                env=daemon_env,
            )

    for _ in range(40):
        if health_ok():
            return
        time.sleep(0.25)

    raise RuntimeError(
        "Daemon EnvSync não respondeu em /health. Veja /tmp/envsync-daemon.log"
    )


def stop_backend() -> None:
    # Prefer graceful RPC; also stop systemd user unit if present.
    try:
        if health_ok():
            rpc("daemon.shutdown")
    except Exception:
        pass

    subprocess.run(
        ["systemctl", "--user", "stop", "envsyncd.service"],
        check=False,
        capture_output=True,
    )

    for _ in range(20):
        if not health_ok():
            return
        time.sleep(0.15)


def register_envsync_scheme() -> None:
    scheme = QWebEngineUrlScheme(b"envsync")
    scheme.setFlags(
        QWebEngineUrlScheme.Flag.SecureScheme
        | QWebEngineUrlScheme.Flag.LocalScheme
        | QWebEngineUrlScheme.Flag.LocalAccessAllowed
        | QWebEngineUrlScheme.Flag.CorsEnabled
    )
    QWebEngineUrlScheme.registerScheme(scheme)


def install_webchannel_script(profile) -> None:
    global _CHANNEL_SCRIPT_INSTALLED
    if _CHANNEL_SCRIPT_INSTALLED:
        return
    script = QWebEngineScript()
    script.setName("envsync-webchannel")
    script.setSourceCode(WEBCHANNEL_BOOTSTRAP)
    script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentReady)
    script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
    script.setRunsOnSubFrames(False)
    profile.scripts().insert(script)
    _CHANNEL_SCRIPT_INSTALLED = True


class DesktopBridge(QObject):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._parent = parent

    @Slot(result=str)
    def pickFolder(self) -> str:
        parent = self._parent if isinstance(self._parent, QWidget) else None
        path = QFileDialog.getExistingDirectory(
            parent,
            "Selecionar pasta",
            str(Path.home()),
            QFileDialog.Option.ShowDirsOnly,
        )
        return path or ""


class EnvSyncWebPage(QWebEnginePage):
    def __init__(self, profile, view: QWebEngineView, bridge: DesktopBridge) -> None:
        super().__init__(profile, view)
        self._view = view
        channel = QWebChannel(self)
        channel.registerObject("envsync", bridge)
        self.setWebChannel(channel)

    def acceptNavigationRequest(self, url: QUrl, _type, isMainFrame) -> bool:  # noqa: N802
        if url.scheme() == "envsync" and url.host() == "pick-folder":
            query = QUrlQuery(url.query())
            req_id = query.queryItemValue("id")
            path = QFileDialog.getExistingDirectory(
                self._view,
                "Selecionar pasta",
                str(Path.home()),
                QFileDialog.Option.ShowDirsOnly,
            )
            payload = json.dumps({"id": req_id, "path": path or ""})
            self.runJavaScript(f"window.__envsyncFolderReply?.({payload})")
            return False
        return super().acceptNavigationRequest(url, _type, isMainFrame)


class EnvSyncWindow(QMainWindow):
    def __init__(self, url: str, icon: QIcon, on_close_to_tray) -> None:
        super().__init__()
        self._on_close_to_tray = on_close_to_tray
        self._force_quit = False
        self.setWindowTitle("EnvSync")
        self.setWindowIcon(icon)

        self.bridge = DesktopBridge(self)
        self.browser = QWebEngineView(self)
        profile = self.browser.page().profile()
        install_webchannel_script(profile)
        self.browser.setPage(EnvSyncWebPage(profile, self.browser, self.bridge))
        self.browser.loadFinished.connect(self._on_load_finished)
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

    def _on_load_finished(self, _ok: bool) -> None:
        self.browser.page().runJavaScript(
            "window.__ENVSYNC_DESKTOP__ = true;"
            "if (window.envsyncDesktop) window.__ENVSYNC_DESKTOP__ = true;"
        )

    def closeEvent(self, event) -> None:  # noqa: N802
        self.settings.setValue("geometry", self.saveGeometry())
        self.settings.setValue("windowState", self.saveState())
        if self._force_quit:
            event.accept()
            return
        event.ignore()
        self.hide()
        self._on_close_to_tray()


class EnvSyncApp:
    def __init__(self) -> None:
        self.app = QApplication(sys.argv)
        self.app.setApplicationName("envsync")
        self.app.setApplicationDisplayName("EnvSync")
        self.app.setDesktopFileName("envsync")
        self.app.setQuitOnLastWindowClosed(False)

        self.icon = resolve_icon()
        self.app.setWindowIcon(self.icon)

        self._status_action: QAction | None = None
        self.tray: QSystemTrayIcon | None = None
        self.window = EnvSyncWindow(URL, self.icon, self._notify_hidden)
        self.tray = self._build_tray()
        self._daemon_alive = health_ok()

        self.poll = QTimer()
        self.poll.setInterval(4000)
        self.poll.timeout.connect(self._refresh_tray_status)
        self.poll.start()

    def _build_tray(self) -> QSystemTrayIcon | None:
        if not QSystemTrayIcon.isSystemTrayAvailable():
            # Sem bandeja: fechar a janela encerra o app (comportamento clássico).
            self.app.setQuitOnLastWindowClosed(True)
            return None

        tray = QSystemTrayIcon(self.icon, self.app)
        tray.setToolTip("EnvSync — daemon ativo")

        menu = QMenu()
        open_action = QAction("Abrir EnvSync", menu)
        open_action.triggered.connect(self.show_window)
        menu.addAction(open_action)

        status_action = QAction("Daemon: verificando…", menu)
        status_action.setEnabled(False)
        menu.addAction(status_action)
        self._status_action = status_action

        menu.addSeparator()
        quit_action = QAction("Encerrar EnvSync (UI + daemon)", menu)
        quit_action.triggered.connect(self.quit_all)
        menu.addAction(quit_action)

        tray.setContextMenu(menu)
        tray.activated.connect(self._on_tray_activated)
        tray.show()
        self._refresh_tray_status()
        return tray

    def _notify_hidden(self) -> None:
        if self.tray is None:
            self.quit_all()
            return
        if self.tray.supportsMessages():
            self.tray.showMessage(
                "EnvSync",
                "Continua na bandeja enquanto o daemon estiver ativo.",
                QSystemTrayIcon.MessageIcon.Information,
                2500,
            )

    def _on_tray_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason in (
            QSystemTrayIcon.ActivationReason.Trigger,
            QSystemTrayIcon.ActivationReason.DoubleClick,
        ):
            self.show_window()

    def show_window(self) -> None:
        self.window.show()
        self.window.raise_()
        self.window.activateWindow()

    def _refresh_tray_status(self) -> None:
        if self.tray is None:
            return
        alive = health_ok()
        self._daemon_alive = alive
        if alive:
            self._status_action.setText("Daemon: online")
            self.tray.setToolTip("EnvSync — daemon online")
            self.tray.setIcon(self.icon)
            if not self.tray.isVisible():
                self.tray.show()
        else:
            self._status_action.setText("Daemon: offline")
            self.tray.setToolTip("EnvSync — daemon offline")

    def quit_all(self) -> None:
        self.poll.stop()
        stop_backend()
        if self.tray is not None:
            self.tray.hide()
        self.window._force_quit = True
        self.window.close()
        self.app.quit()

    def run(self) -> int:
        self.show_window()
        return self.app.exec()


def main() -> int:
    sys.argv[0] = "envsync"
    register_envsync_scheme()
    start_backend()

    QGuiApplication.setApplicationName("envsync")
    QGuiApplication.setApplicationDisplayName("EnvSync")
    QGuiApplication.setDesktopFileName("envsync")

    return EnvSyncApp().run()


if __name__ == "__main__":
    raise SystemExit(main())
