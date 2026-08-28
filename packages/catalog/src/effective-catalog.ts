import { DEFAULT_CATALOG } from "./default-catalog.js";
import { collectSeedPackageKeys, discoverInstalledPackages } from "./discover.js";
import type { Catalog, CatalogItem } from "./types.js";

export type CatalogState = {
  customItems: CatalogItem[];
  hiddenItemIds: string[];
};

export const EMPTY_CATALOG_STATE: CatalogState = {
  customItems: [],
  hiddenItemIds: [],
};

function itemPackageKeys(item: CatalogItem): string[] {
  const keys: string[] = [];
  for (const provider of item.providers) {
    if (provider.type === "package") {
      keys.push(`${provider.manager}:${provider.name}`);
    }
  }
  return keys;
}

/** Une definições de itens; prioriza seed/custom sobre auto-descobertos com mesmo pacote. */
export function mergeItemDefinitions(items: CatalogItem[]): CatalogItem[] {
  const byId = new Map<string, CatalogItem>();
  const packageOwner = new Map<string, string>();

  for (const item of items) {
    byId.set(item.id, item);
    for (const key of itemPackageKeys(item)) {
      if (!packageOwner.has(key)) packageOwner.set(key, item.id);
    }
  }

  const merged: CatalogItem[] = [];
  const seenPackages = new Set<string>();

  for (const item of items) {
    if (!byId.has(item.id)) continue;

    const keys = itemPackageKeys(item);
    if (keys.length > 0) {
      const owned = keys.every((key) => packageOwner.get(key) === item.id);
      if (!owned) continue;
      const duplicate = keys.some((key) => seenPackages.has(key));
      if (duplicate) continue;
      for (const key of keys) seenPackages.add(key);
    }

    if (merged.some((entry) => entry.id === item.id)) continue;
    merged.push(item);
  }

  return merged;
}

export async function buildEffectiveCatalog(
  state: CatalogState,
): Promise<Catalog> {
  const seedKeys = collectSeedPackageKeys(DEFAULT_CATALOG.items);
  for (const item of state.customItems) {
    for (const key of itemPackageKeys(item)) seedKeys.add(key);
  }

  const discovered = await discoverInstalledPackages(seedKeys);
  const hidden = new Set(state.hiddenItemIds);
  const items = mergeItemDefinitions([
    ...DEFAULT_CATALOG.items,
    ...state.customItems,
    ...discovered,
  ]).filter((item) => !hidden.has(item.id));

  const groups = [...DEFAULT_CATALOG.groups];
  if (discovered.length > 0 && !groups.some((group) => group.id === "discovered")) {
    groups.push({ id: "discovered", label: "Descobertos automaticamente", icon: "scan" });
  }

  return { groups, items };
}
