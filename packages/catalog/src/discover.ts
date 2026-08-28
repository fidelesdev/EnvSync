import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CatalogItem } from "./types.js";

const execFileAsync = promisify(execFile);

export async function listPacmanPackages(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("pacman", ["-Qqe"]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function listFlatpakApps(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("flatpak", [
      "list",
      "--app",
      "--columns=application",
    ]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function packageKey(manager: string, name: string): string {
  return `${manager}:${name}`;
}

export function collectSeedPackageKeys(items: CatalogItem[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    for (const provider of item.providers) {
      if (provider.type === "package") {
        keys.add(packageKey(provider.manager, provider.name));
      }
    }
  }
  return keys;
}

export function discoveredPackageItems(
  seedKeys: Set<string>,
): Promise<CatalogItem[]> {
  return discoverInstalledPackages(seedKeys);
}

export async function discoverInstalledPackages(
  seedKeys: Set<string>,
): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  const seen = new Set<string>();

  for (const name of await listPacmanPackages()) {
    const key = packageKey("pacman", name);
    if (seedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `auto:pacman:${name}`,
      label: name,
      groupId: "discovered",
      providers: [{ type: "package", manager: "pacman", name }],
    });
  }

  for (const appId of await listFlatpakApps()) {
    const key = packageKey("flatpak", appId);
    if (seedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `auto:flatpak:${appId}`,
      label: appId,
      groupId: "discovered",
      providers: [{ type: "package", manager: "flatpak", name: appId }],
    });
  }

  return items.sort((left, right) => left.label.localeCompare(right.label));
}

export function customPathItem(label: string, rawPath: string): CatalogItem {
  const normalized = rawPath.trim();
  const slug = normalized
    .replace(/^~\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const id = `custom:${slug || "path"}:${Buffer.from(normalized).toString("base64url").slice(0, 12)}`;
  return {
    id,
    label: label.trim() || normalized,
    groupId: "folders",
    providers: [{ type: "paths", paths: [normalized] }],
  };
}
