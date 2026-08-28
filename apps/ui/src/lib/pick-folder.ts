import { ipc } from "../ipc/client";

type FolderReply = {
  id: string;
  path: string;
};

const pending = new Map<string, (path: string | null) => void>();

declare global {
  interface Window {
    __envsyncFolderReply?: (payload: FolderReply) => void;
    __ENVSYNC_DESKTOP__?: boolean;
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

function pickFolderViaDesktop(): Promise<string | null> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, resolve);

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `envsync://pick-folder?id=${encodeURIComponent(id)}`;
    document.body.appendChild(iframe);
    window.setTimeout(() => iframe.remove(), 500);
  });
}

export async function pickFolder(): Promise<string | null> {
  if (window.__ENVSYNC_DESKTOP__) {
    return pickFolderViaDesktop();
  }

  const result = await ipc<{ path: string | null }>("catalog.pickFolder");
  return result.path;
}
