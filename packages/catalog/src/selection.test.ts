import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "./default-catalog.js";
import { toggleGroupSelection } from "./selection.js";

describe("toggleGroupSelection", () => {
  it("selects all items in group", () => {
    const selected = new Set<string>();
    const next = toggleGroupSelection(DEFAULT_CATALOG, selected, "cli", true);
    const cliIds = DEFAULT_CATALOG.items
      .filter((item) => item.groupId === "cli")
      .map((item) => item.id);
    for (const id of cliIds) expect(next.has(id)).toBe(true);
  });
});
