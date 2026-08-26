import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateIdentity, certFingerprint } from "./identity.js";

describe("identity", () => {
  it("creates cert with 64-char fingerprint", () => {
    const dir = mkdtempSync(join(tmpdir(), "envsync-id-"));
    const identity = loadOrCreateIdentity(dir);
    expect(identity.fingerprint.length).toBe(64);
    const again = loadOrCreateIdentity(dir);
    expect(again.fingerprint).toBe(identity.fingerprint);
    writeFileSync(join(dir, "marker"), "ok");
    expect(certFingerprint(identity.certPem).length).toBe(64);
  });
});
