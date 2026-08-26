export type EnvsyncApi = {
  invoke: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  platform: string;
};

declare global {
  interface Window {
    envsync: EnvsyncApi;
  }
}

export async function ipc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!window.envsync) {
    throw new Error("Bridge EnvSync indisponível (abra via Electron)");
  }
  return window.envsync.invoke(method, params) as Promise<T>;
}
