import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { assertConfirmed, type ApplyArgs, type PluginContext, type SyncPlugin } from "./types.js";

export function managedEnvPath(home = homedir()): string {
  return join(home, ".config", "envsync", "env.managed");
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

export const envPlugin: SyncPlugin = {
  id: "env",
  async fingerprint(keysCsv: string, _ctx: PluginContext): Promise<string> {
    const keys = keysCsv.split(",").filter(Boolean);
    const path = managedEnvPath();
    const values = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
    const hash = createHash("sha256");
    for (const key of keys.sort()) {
      hash.update(key);
      hash.update("=");
      hash.update(values[key] ?? "");
      hash.update("\n");
    }
    return hash.digest("hex");
  },
  async apply(args: ApplyArgs): Promise<void> {
    assertConfirmed(args.confirmed);
    const keys = args.envKeys ?? [];
    const incoming = args.envValues ?? {};
    const path = managedEnvPath();
    mkdirSync(dirname(path), { recursive: true });
    const current = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
    mkdirSync(args.ctx.backupRoot, { recursive: true });
    writeFileSync(join(args.ctx.backupRoot, "env.managed"), JSON.stringify(current, null, 2));
    for (const key of keys) {
      if (key in incoming) current[key] = incoming[key] ?? "";
    }
    const body = Object.entries(current)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    writeFileSync(path, body + (body ? "\n" : ""));
  },
};
