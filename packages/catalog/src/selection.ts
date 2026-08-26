import type { Catalog } from "./types.js";

export function toggleGroupSelection(
  catalog: Catalog,
  selected: Set<string>,
  groupId: string,
  select: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const item of catalog.items) {
    if (item.groupId !== groupId) continue;
    if (select) next.add(item.id);
    else next.delete(item.id);
  }
  return next;
}

export function toggleItemSelection(
  selected: Set<string>,
  itemId: string,
  select: boolean,
): Set<string> {
  const next = new Set(selected);
  if (select) next.add(itemId);
  else next.delete(itemId);
  return next;
}

export function isGroupFullySelected(
  catalog: Catalog,
  selected: Set<string>,
  groupId: string,
): boolean {
  const groupItems = catalog.items.filter((item) => item.groupId === groupId);
  if (groupItems.length === 0) return false;
  return groupItems.every((item) => selected.has(item.id));
}
