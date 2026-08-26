import { homedir } from "node:os";
import { join } from "node:path";
import { IPC_SOCKET_NAME, PRODUCT_NAME } from "@envsync/protocol";

export function dataDir(home = homedir()): string {
  return (
    process.env.ENVSYNC_DATA_DIR ??
    join(home, ".local", "share", PRODUCT_NAME)
  );
}

export function backupDir(sessionId: string, home = homedir()): string {
  return join(dataDir(home), "backups", sessionId);
}

export function socketPath(): string {
  if (process.env.ENVSYNC_SOCKET) return process.env.ENVSYNC_SOCKET;
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) return join(runtime, IPC_SOCKET_NAME);
  return join("/tmp", `envsync-${process.getuid?.() ?? "user"}.sock`);
}

export function expandHome(path: string, home = homedir()): string {
  if (path.startsWith("~/")) return join(home, path.slice(2));
  if (path === "~") return home;
  return path;
}
