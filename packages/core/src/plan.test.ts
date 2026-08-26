import { describe, expect, it } from "vitest";
import { buildPlan } from "./plan.js";

describe("buildPlan", () => {
  it("marks conflict when both present with different fingerprints", () => {
    const plan = buildPlan(
      [
        {
          itemId: "chrome",
          fingerprint: "a",
          presence: "present",
          detail: "local",
        },
      ],
      [
        {
          itemId: "chrome",
          fingerprint: "b",
          presence: "present",
          detail: "remote",
        },
      ],
      ["chrome"],
      "peer-1",
    );
    expect(plan.confirmed).toBe(false);
    expect(plan.actions[0]?.kind).toBe("conflict");
  });

  it("never returns confirmed true", () => {
    const plan = buildPlan(
      [
        {
          itemId: "ripgrep",
          fingerprint: "1",
          presence: "present",
          detail: "",
        },
      ],
      [
        {
          itemId: "ripgrep",
          fingerprint: "",
          presence: "absent",
          detail: "",
        },
      ],
      ["ripgrep"],
      "peer-1",
    );
    expect(plan.confirmed).toBe(false);
    expect(plan.actions[0]?.kind).toBe("install");
    expect(plan.actions[0]?.direction).toBe("push");
  });
});
