export type PluginContext = {
  dataDir: string;
  backupRoot: string;
};

export type ApplyArgs = {
  direction: "push" | "pull";
  sourcePath?: string;
  targetPath?: string;
  packageName?: string;
  envKeys?: string[];
  envValues?: Record<string, string>;
  ctx: PluginContext;
  confirmed: true;
};

export type SyncPlugin = {
  id: string;
  fingerprint(target: string, ctx: PluginContext): Promise<string>;
  apply(args: ApplyArgs): Promise<void>;
};

export function assertConfirmed(confirmed: boolean): asserts confirmed is true {
  if (confirmed !== true) {
    throw new Error("Apply recusado: plano não confirmado");
  }
}
