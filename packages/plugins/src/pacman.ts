import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertConfirmed, type ApplyArgs, type PluginContext, type SyncPlugin } from "./types.js";

const execFileAsync = promisify(execFile);

async function pacmanQuery(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("pacman", ["-Q", name]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export const pacmanPlugin: SyncPlugin = {
  id: "pacman",
  async fingerprint(name: string, _ctx: PluginContext): Promise<string> {
    return (await pacmanQuery(name)) ?? "";
  },
  async apply(args: ApplyArgs): Promise<void> {
    assertConfirmed(args.confirmed);
    const name = args.packageName;
    if (!name) throw new Error("pacman.apply requer packageName");
    if (args.direction === "push") {
      // Push means ensure peer installs; locally we only verify presence.
      const local = await pacmanQuery(name);
      if (!local) throw new Error(`Pacote local ausente para push: ${name}`);
      return;
    }
    await execFileAsync("sudo", ["pacman", "-S", "--noconfirm", "--needed", name]);
  },
};

export async function detectAurHelper(): Promise<"yay" | "paru" | null> {
  for (const helper of ["yay", "paru"] as const) {
    try {
      await execFileAsync(helper, ["--version"]);
      return helper;
    } catch {
      // try next
    }
  }
  return null;
}

export const aurPlugin: SyncPlugin = {
  id: "aur",
  async fingerprint(name: string, _ctx: PluginContext): Promise<string> {
    return (await pacmanQuery(name)) ?? "";
  },
  async apply(args: ApplyArgs): Promise<void> {
    assertConfirmed(args.confirmed);
    const name = args.packageName;
    if (!name) throw new Error("aur.apply requer packageName");
    if (args.direction === "push") {
      const local = await pacmanQuery(name);
      if (!local) throw new Error(`Pacote AUR local ausente para push: ${name}`);
      return;
    }
    const helper = await detectAurHelper();
    if (!helper) throw new Error("Nenhum helper AUR (yay/paru) encontrado");
    await execFileAsync(helper, ["-S", "--noconfirm", "--needed", name]);
  },
};

export const flatpakPlugin: SyncPlugin = {
  id: "flatpak",
  async fingerprint(name: string, _ctx: PluginContext): Promise<string> {
    try {
      const { stdout } = await execFileAsync("flatpak", ["info", name]);
      return createStable(stdout);
    } catch {
      return "";
    }
  },
  async apply(args: ApplyArgs): Promise<void> {
    assertConfirmed(args.confirmed);
    const name = args.packageName;
    if (!name) throw new Error("flatpak.apply requer packageName");
    if (args.direction === "push") return;
    await execFileAsync("flatpak", ["install", "-y", name]);
  },
};

function createStable(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("|");
}

export const appimagePlugin: SyncPlugin = {
  id: "appimage",
  async fingerprint(path: string, ctx: PluginContext): Promise<string> {
    const { fingerprintPath } = await import("./files.js");
    return fingerprintPath(path);
  },
  async apply(args: ApplyArgs): Promise<void> {
    assertConfirmed(args.confirmed);
    const { filesPlugin } = await import("./files.js");
    await filesPlugin.apply(args);
  },
};
