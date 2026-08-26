import { describe, expect, it } from "vitest";
import { buildPlan } from "@envsync/core";
import { markPlanConfirmed } from "@envsync/core";

describe("sync plan gate", () => {
  it("confirm requires explicit mark", () => {
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
    const confirmed = markPlanConfirmed(plan);
    expect(confirmed.confirmed).toBe(true);
    expect(() => markPlanConfirmed(confirmed)).toThrow(/já confirmado/);
  });
});
