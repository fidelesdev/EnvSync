import type { Catalog, CatalogItem } from "@envsync/catalog";
import { expandHome, type ItemInventory } from "@envsync/core";
import {
  envPlugin,
  fingerprintPath,
  getPlugin,
  managedEnvPath,
} from "@envsync/plugins";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function combineFingerprints(parts: string[]): string {
  const present = parts.filter(Boolean);
  if (present.length === 0) return "";
  return createHash("sha256").update(present.join("|")).digest("hex");
}

async function itemInventory(item: CatalogItem): Promise<ItemInventory> {
  const parts: string[] = [];
  const details: string[] = [];

  for (const provider of item.providers) {
    if (provider.type === "package") {
      const plugin = getPlugin(provider.manager === "aur" ? "aur" : provider.manager);
      const fp = await plugin.fingerprint(provider.name, {
        dataDir: "",
        backupRoot: "",
      });
      parts.push(fp);
      if (fp) details.push(fp);
    } else if (provider.type === "paths") {
      for (const raw of provider.paths) {
        const path = expandHome(raw);
        const fp = fingerprintPath(path, provider.excludes ?? []);
        parts.push(fp);
        if (fp) details.push(path);
      }
    } else if (provider.type === "env") {
      const fp = await envPlugin.fingerprint(provider.keys.join(","), {
        dataDir: "",
        backupRoot: "",
      });
      parts.push(fp);
      if (existsSync(managedEnvPath())) details.push("env.managed");
    }
  }

  const fingerprint = combineFingerprints(parts);
  return {
    itemId: item.id,
    fingerprint,
    presence: fingerprint ? "present" : "absent",
    detail: details.join(", "),
  };
}

export async function buildLocalInventory(
  catalog: Catalog,
  itemIds: string[],
): Promise<ItemInventory[]> {
  const selected = catalog.items.filter((item) => itemIds.includes(item.id));
  const rows: ItemInventory[] = [];
  for (const item of selected) {
    rows.push(await itemInventory(item));
  }
  return rows;
}

export function readManagedEnvValues(keys: string[]): Record<string, string> {
  const path = managedEnvPath();
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    if (keys.includes(key)) result[key] = trimmed.slice(eq + 1);
  }
  return result;
}
