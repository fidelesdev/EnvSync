import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { CatalogItem } from "@envsync/catalog";
import type { ConflictDetail } from "@envsync/protocol";
import { expandHome } from "@envsync/core";
import { fingerprintPath } from "@envsync/plugins";
import type { PeerTransport } from "./peer-client.js";
import type { PeerInfo } from "@envsync/protocol";

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".conf",
  ".cfg",
  ".ini",
  ".sh",
  ".bash",
  ".zsh",
  ".env",
  ".gitconfig",
  ".bashrc",
  ".profile",
  ".md",
  ".txt",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".xml",
]);

const MAX_PREVIEW_BYTES = 48_000;

function isProbablyText(path: string): boolean {
  const name = basename(path);
  if (name.startsWith(".")) return true;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function readPreview(absPath: string): string | undefined {
  if (!existsSync(absPath)) return undefined;
  const info = statSync(absPath);
  if (!info.isFile() || info.size > MAX_PREVIEW_BYTES) return undefined;
  if (!isProbablyText(absPath)) return undefined;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return undefined;
  }
}

function buildDiff(localText: string, remoteText: string): string {
  const localLines = localText.split("\n");
  const remoteLines = remoteText.split("\n");
  const max = Math.max(localLines.length, remoteLines.length);
  const chunks: string[] = [];
  for (let index = 0; index < max; index += 1) {
    const left = localLines[index] ?? "";
    const right = remoteLines[index] ?? "";
    if (left === right) {
      chunks.push(`  ${left}`);
      continue;
    }
    if (left) chunks.push(`- ${left}`);
    if (right) chunks.push(`+ ${right}`);
  }
  return chunks.slice(0, 120).join("\n");
}

function summarizePath(absPath: string): string {
  if (!existsSync(absPath)) return "ausente";
  const info = statSync(absPath);
  if (info.isDirectory()) return `pasta (${info.size} bytes meta)`;
  return `arquivo (${info.size} bytes)`;
}

export async function buildConflictDetails(
  item: CatalogItem,
  peer: PeerInfo,
  transport: PeerTransport,
): Promise<ConflictDetail[]> {
  const details: ConflictDetail[] = [];

  for (const provider of item.providers) {
    if (provider.type === "package") {
      details.push({
        id: `${item.id}:pkg:${provider.name}`,
        label: provider.name,
        kind: "package",
        localSummary: "versão local diferente",
        remoteSummary: "versão remota diferente",
      });
      continue;
    }

    if (provider.type === "env") {
      details.push({
        id: `${item.id}:env`,
        label: provider.keys.join(", "),
        kind: "env",
        localSummary: "variáveis locais diferentes",
        remoteSummary: "variáveis remotas diferentes",
      });
      continue;
    }

    for (const raw of provider.paths) {
      const localPath = expandHome(raw);
      const localFp = fingerprintPath(localPath, provider.excludes ?? []);
      const remoteInspect = await transport.inspectPath(peer, raw);
      const remoteFp = remoteInspect.fingerprint;

      if (localFp === remoteFp) continue;

      const localPreview = readPreview(localPath);
      const remotePreview = remoteInspect.preview;
      let diff: string | undefined;
      if (localPreview !== undefined && remotePreview !== undefined) {
        diff = buildDiff(localPreview, remotePreview);
      }

      details.push({
        id: `${item.id}:path:${raw}`,
        label: raw,
        kind: "path",
        localSummary: summarizePath(localPath),
        remoteSummary: remoteInspect.missing
          ? "ausente no remoto"
          : remoteInspect.isDirectory
            ? "pasta remota diferente"
            : `arquivo remoto (${remoteInspect.size ?? "?"} bytes)`,
        diff,
        localPreview,
        remotePreview,
      });
    }
  }

  if (details.length === 0) {
    details.push({
      id: `${item.id}:item`,
      label: item.label,
      kind: "path",
      localSummary: "conteúdo local diferente",
      remoteSummary: "conteúdo remoto diferente",
    });
  }

  return details;
}
