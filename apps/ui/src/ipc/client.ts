const RPC_URL =
  import.meta.env.VITE_ENVSYNC_RPC_URL ??
  `${window.location.origin}/rpc`;

export async function ipc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "Erro RPC");
  }

  return payload.result as T;
}
