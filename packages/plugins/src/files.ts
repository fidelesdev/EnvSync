import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { assertConfirmed, type ApplyArgs, type PluginContext, type SyncPlugin } from "./types.js";

function hashFile(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function walkFiles(root: string, excludes: string[] = []): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) return [root];

  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = relative(root, full);
      const excluded = excludes.some((pattern) => {
        if (pattern.endsWith("/**")) {
          const prefix = pattern.slice(0, -3);
          return rel === prefix || rel.startsWith(prefix + "/");
        }
        if (pattern.startsWith("**/")) {
          return entry.name === pattern.slice(3) || rel.endsWith("/" + pattern.slice(3));
        }
        return rel === pattern || entry.name === pattern;
      });
      if (excluded) continue;
      if (entry.isDirectory()) stack.push(full);
      else results.push(full);
    }
  }
  return results.sort();
}

export const filesPlugin: SyncPlugin = {
  id: "files",
  async fingerprint(target: string, _ctx: PluginContext): Promise<string> {
    const files = walkFiles(target);
    if (files.length === 0) return "";
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(relative(target, file));
      hash.update("\0");
      hash.update(hashFile(file));
      hash.update("\n");
    }
    return hash.digest("hex");
  },
  async apply(args: ApplyArgs): Promise<void> {
    assertConfirmed(args.confirmed);
    const source = args.sourcePath;
    const target = args.targetPath;
    if (!source || !target) throw new Error("files.apply requer sourcePath e targetPath");
    if (!existsSync(source)) throw new Error(`Origem inexistente: ${source}`);

    mkdirSync(args.ctx.backupRoot, { recursive: true });
    if (existsSync(target)) {
      const backupTarget = join(args.ctx.backupRoot, relative("/", target).replaceAll("/", "_"));
      mkdirSync(dirname(backupTarget), { recursive: true });
      cpSync(target, backupTarget, { recursive: true });
    }

    mkdirSync(dirname(target), { recursive: true });
    const sourceStat = statSync(source);
    if (sourceStat.isDirectory()) {
      cpSync(source, target, { recursive: true });
    } else {
      copyFileSync(source, target);
    }
  },
};

export function fingerprintPath(path: string, excludes: string[] = []): string {
  const files = walkFiles(path, excludes);
  if (files.length === 0) return "";
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(path, file) || file);
    hash.update("\0");
    hash.update(hashFile(file));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export { walkFiles, renameSync };
