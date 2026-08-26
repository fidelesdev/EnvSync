import { describe, expect, it } from "vitest";
import { encodeJsonRpcRequest, parseJsonRpcLine } from "./jsonrpc.js";

describe("jsonrpc", () => {
  it("round-trips a request line", () => {
    const line = encodeJsonRpcRequest(1, "catalog.list", {});
    const parsed = parseJsonRpcLine(line);
    expect(parsed).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "catalog.list",
      params: {},
    });
  });
});
