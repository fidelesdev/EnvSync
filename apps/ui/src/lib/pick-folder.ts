import { ipc } from "../ipc/client";

type FolderReply = {
  id: string;
  path: string;
};

type DesktopBridge = {
  pickFolder: (() => string) | ((callback: (path: string) => void) => void);
};

const pending = new Map<string, (path: string | null) => void>();

declare global {
  interface Window {
    __envsyncFolderReply?: (payload: FolderReply) => void;
    __ENVSYNC_DESKTOP__?: boolean;
    envsyncDesktop?: DesktopBridge;
  }
}

if (typeof window !== "undefined") {
  window.__envsyncFolderReply = (payload: FolderReply) => {
    const resolve = pending.get(payload.id);
    if (!resolve) return;
    pending.delete(payload.id);
    resolve(payload.path || null);
  };
}

async function waitForDesktopBridge(timeoutMs = 4000): Promise<DesktopBridge | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (window.envsyncDesktop?.pickFolder) {
      return window.envsyncDesktop;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  return null;
}

function invokeDesktopPickFolder(bridge: DesktopBridge): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const method = bridge.pickFolder;
      if (method.length === 0) {
        const path = (method as () => string)();
        resolve(path || null);
        return;
      }
      (method as (callback: (path: string) => void) => void)((path) => {
        resolve(path || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function pickFolderViaDesktopScheme(timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, resolve);

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `envsync://pick-folder?id=${encodeURIComponent(id)}`;
    document.body.appendChild(iframe);
    window.setTimeout(() => iframe.remove(), 500);

    window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
  });
}

async function pickFolderViaDesktop(): Promise<string | null> {
  const bridge = await waitForDesktopBridge();
  if (bridge) {
    const path = await invokeDesktopPickFolder(bridge);
    if (path) return path;
  }

  if (window.__ENVSYNC_DESKTOP__) {
    return pickFolderViaDesktopScheme();
  }

  return null;
}

export async function pickFolder(): Promise<string | null> {
  if (window.__ENVSYNC_DESKTOP__) {
    const desktopPath = await pickFolderViaDesktop();
    if (desktopPath) return desktopPath;
  }

  const result = await ipc<{ path: string | null }>("catalog.pickFolder");
  return result.path;
}
