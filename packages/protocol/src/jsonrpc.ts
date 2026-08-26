export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown;
};

export type JsonRpcError = {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
};

export function encodeJsonRpcRequest(
  id: number | string,
  method: string,
  params: unknown = {},
): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

export function encodeJsonRpcResult(
  id: number | string,
  result: unknown,
): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
}

export function encodeJsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): string {
  return (
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, data } }) +
    "\n"
  );
}

export function parseJsonRpcLine(
  line: string,
): JsonRpcRequest | JsonRpcResponse | JsonRpcError {
  const trimmed = line.trim();
  if (!trimmed) throw new Error("empty jsonrpc line");
  const value: unknown = JSON.parse(trimmed);
  if (typeof value !== "object" || value === null || !("jsonrpc" in value)) {
    throw new Error("invalid jsonrpc");
  }
  return value as JsonRpcRequest | JsonRpcResponse | JsonRpcError;
}
