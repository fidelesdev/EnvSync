import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filesPlugin, fingerprintPath } from "./files.js";
import { assertConfirmed } from "./types.js";

describe("files plugin", () => {
  it("fingerprints fixture dir stably", () => {
    const dir = mkdtempSync(join(tmpdir(), "envsync-files-"));
    writeFileSync(join(dir, "a.txt"), "hello");
    const first = fingerprintPath(dir);
    const second = fingerprintPath(dir);
    expect(first).toBe(second);
    expect(first.length).toBe(64);
  });

  it("rejects apply without confirmation at runtime", async () => {
    expect(() => assertConfirmed(false)).toThrow(/não confirmado/);
    await expect(
      filesPlugin.apply({
        direction: "pull",
        sourcePath: "/tmp",
        targetPath: "/tmp/x",
        ctx: { dataDir: "/tmp", backupRoot: "/tmp/b" },
        // @ts-expect-error intentional runtime bypass check
        confirmed: false,
      }),
    ).rejects.toThrow(/não confirmado/);
  });
});

describe("hash helper sanity", () => {
  it("sha256 length", () => {
    expect(createHash("sha256").update("x").digest("hex").length).toBe(64);
    mkdirSync(join(tmpdir(), "envsync-keep"), { recursive: true });
  });
});
