import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeJsonRpcRequest, parseJsonRpcLine } from "@envsync/protocol";
import { createConnection } from "node:net";
import { IpcServer } from "./ipc-server.js";

describe("IpcServer", () => {
  it("answers daemon.ping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "envsync-ipc-"));
    const sock = join(dir, "test.sock");
    const server = new IpcServer(sock, async (method) => {
      if (method === "daemon.ping") return { ok: true, version: "0.1.0" };
      throw new Error("unexpected");
    });
    await server.start();

    const result = await new Promise<unknown>((resolve, reject) => {
      const client = createConnection(sock, () => {
        client.write(encodeJsonRpcRequest(1, "daemon.ping", {}));
      });
      let buffer = "";
      client.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const idx = buffer.indexOf("\n");
        if (idx >= 0) {
          try {
            const msg = parseJsonRpcLine(buffer.slice(0, idx));
            if ("result" in msg) resolve(msg.result);
            else reject(new Error("no result"));
          } catch (error) {
            reject(error);
          } finally {
            client.end();
          }
        }
      });
      client.on("error", reject);
    });

    expect(result).toEqual({ ok: true, version: "0.1.0" });
    await server.stop();
  });
});
