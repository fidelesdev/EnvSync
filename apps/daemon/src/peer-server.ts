import {
  createServer as createTlsServer,
  connect as tlsConnect,
  type TLSSocket,
} from "node:tls";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { PackageManager } from "@envsync/catalog";
import { backupDir, expandHome, toLogicalPath, type ItemInventory } from "@envsync/core";
import { envPlugin, filesPlugin, fingerprintPath, getPlugin } from "@envsync/plugins";
import type { CatalogSnapshot, PeerInfo, RemoteDirListing } from "@envsync/protocol";
import type { CatalogService } from "./catalog-service.js";
import type { DeviceIdentity } from "./identity.js";
import { peerCertFingerprint } from "./identity.js";
import { buildLocalInventory, readManagedEnvValues } from "./inventory.js";
import { catalogLog } from "./catalog-log.js";
import { pickFolderDialog } from "./folder-picker.js";
import type { PeerTransport, PathInspectResult, PathStatResult, CatalogRequester } from "./peer-client.js";
import { PEER_PORT } from "./discovery.js";
import type { DaemonStore } from "./store.js";

type PeerRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type PeerResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

type PathPayload = {
  missing?: boolean;
  kind?: "file" | "tar.gz";
  contentBase64?: string;
  entryName?: string;
};

const PEER_RPC_TIMEOUT_MS = 45_000;

function statPathWithinHome(logical: string): PathStatResult {
  const home = homedir();
  const abs = expandHome(logical, home);
  if (!abs.startsWith(home)) {
    throw new Error("Só é permitido validar pastas dentro do home do usuário remoto");
  }
  if (!existsSync(abs)) {
    return { missing: true, isDirectory: false };
  }
  return { missing: false, isDirectory: statSync(abs).isDirectory() };
}

function listDirWithinHome(logical: string): RemoteDirListing {
  const home = homedir();
  const abs = expandHome(logical, home);
  if (!abs.startsWith(home)) {
    throw new Error("Só é permitido listar pastas dentro do home do usuário remoto");
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`Pasta não encontrada: ${logical}`);
  }

  const entries = readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: toLogicalPath(join(abs, entry.name), home),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const parent = abs === home ? null : toLogicalPath(dirname(abs), home);

  return {
    path: toLogicalPath(abs, home),
    parent,
    entries,
  };
}

function peerFingerprint(socket: TLSSocket): string {
  return peerCertFingerprint(socket);
}

function packPath(absPath: string): PathPayload {
  if (!existsSync(absPath)) return { missing: true };
  const info = statSync(absPath);
  if (info.isFile()) {
    return {
      kind: "file",
      contentBase64: readFileSync(absPath).toString("base64"),
      entryName: basename(absPath),
    };
  }
  if (info.isDirectory()) {
    const staging = mkdtempSync(join(tmpdir(), "envsync-tar-"));
    const archive = join(staging, "payload.tar.gz");
    execFileSync("tar", [
      "-C",
      dirname(absPath),
      "-czf",
      archive,
      basename(absPath),
    ]);
    const contentBase64 = readFileSync(archive).toString("base64");
    rmSync(staging, { recursive: true, force: true });
    return {
      kind: "tar.gz",
      contentBase64,
      entryName: basename(absPath),
    };
  }
  return { missing: true };
}

function unpackPath(
  target: string,
  payload: PathPayload,
  backupRoot: string,
  dataDir: string,
): void {
  if (payload.missing || !payload.contentBase64 || !payload.kind) return;
  const staging = mkdtempSync(join(tmpdir(), "envsync-unpack-"));
  try {
    if (payload.kind === "file") {
      const tmp = join(staging, payload.entryName ?? "file");
      writeFileSync(tmp, Buffer.from(payload.contentBase64, "base64"));
      void filesPlugin.apply({
        direction: "pull",
        sourcePath: tmp,
        targetPath: target,
        ctx: { dataDir, backupRoot },
        confirmed: true,
      });
      return;
    }

    const archive = join(staging, "payload.tar.gz");
    writeFileSync(archive, Buffer.from(payload.contentBase64, "base64"));
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    if (existsSync(target)) {
      const backupTarget = join(backupRoot, `${basename(target)}-${Date.now()}`);
      mkdirSync(backupRoot, { recursive: true });
      execFileSync("cp", ["-a", target, backupTarget]);
      rmSync(target, { recursive: true, force: true });
    }
    execFileSync("tar", ["-C", parent, "-xzf", archive]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export class TlsPeerServer {
  constructor(
    private readonly identity: DeviceIdentity,
    private readonly store: DaemonStore,
    private readonly catalog: CatalogService,
  ) {}

  start(port = PEER_PORT): void {
    const server = createTlsServer(
      {
        key: this.identity.keyPem,
        cert: this.identity.certPem,
        requestCert: true,
        rejectUnauthorized: false,
      },
      (socket) => {
        void this.handleSocket(socket);
      },
    );
    server.listen(port);
  }

  private async handleSocket(socket: TLSSocket): Promise<void> {
    const peerFp = peerFingerprint(socket);
    if (!peerFp) {
      catalogLog("error", "peer TLS sem certificado legível (getPeerCertificate)", {
        hint: "TLS 1.3 exige getPeerCertificate(true)",
      });
      socket.write(
        JSON.stringify({ id: "0", error: "certificado peer ausente" }) + "\n",
      );
      socket.end();
      return;
    }

    if (!this.store.isTrusted(peerFp)) {
      const trusted = this.store.listTrusted().map((entry) => entry.fingerprint.slice(0, 16));
      catalogLog("error", "peer TLS rejeitado — não pareado nesta máquina", {
        peerFingerprint: peerFp.slice(0, 16),
        trustedFingerprints: trusted,
        hint: "Pareie também neste dispositivo (confiança mútua)",
      });
      this.store.addActivity(
        "catalog",
        `Conexão recusada: peer ${peerFp.slice(0, 12)}… não confiável`,
      );
      socket.write(JSON.stringify({ id: "0", error: "untrusted peer" }) + "\n");
      socket.end();
      return;
    }

    catalogLog("info", "peer TLS conectado", { fingerprint: peerFp.slice(0, 16) });

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        void this.dispatch(socket, line);
        idx = buffer.indexOf("\n");
      }
    });
  }

  private async dispatch(socket: TLSSocket, line: string): Promise<void> {
    let requestId = "?";
    try {
      const req = JSON.parse(line) as PeerRequest;
      requestId = req.id;
      catalogLog("info", "peer RPC recebido", { method: req.method, id: req.id });
      const started = Date.now();
      const result = await this.handleMethod(req.method, req.params ?? {});
      catalogLog("info", "peer RPC concluído", {
        method: req.method,
        ms: Date.now() - started,
      });
      const response: PeerResponse = { id: req.id, result };
      socket.write(JSON.stringify(response) + "\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      catalogLog("error", "peer RPC falhou", { id: requestId, error: message });
      socket.write(JSON.stringify({ id: requestId, error: message }) + "\n");
    }
  }

  private async handleMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "inventory.get") {
      const itemIds = params.itemIds as string[];
      const effective = await this.catalog.getEffectiveCatalog();
      return buildLocalInventory(effective, itemIds);
    }
    if (method === "catalog.snapshot") {
      const requester: CatalogRequester = {
        deviceName: String(params.requesterName ?? "dispositivo remoto"),
        fingerprint: String(params.requesterFingerprint ?? ""),
      };
      return this.catalog.getSnapshot(requester);
    }
    if (method === "package.install") {
      const manager = params.manager as PackageManager;
      const name = params.name as string;
      const plugin = getPlugin(manager === "aur" ? "aur" : manager);
      await plugin.apply({
        direction: "pull",
        packageName: name,
        ctx: {
          dataDir: this.store.root,
          backupRoot: backupDir("remote-install"),
        },
        confirmed: true,
      });
      return { ok: true };
    }
    if (method === "env.get") {
      return readManagedEnvValues(params.keys as string[]);
    }
    if (method === "env.put") {
      await envPlugin.apply({
        direction: "pull",
        envKeys: params.keys as string[],
        envValues: params.values as Record<string, string>,
        ctx: { dataDir: this.store.root, backupRoot: backupDir("remote-env") },
        confirmed: true,
      });
      return { ok: true };
    }
    if (method === "path.read") {
      return packPath(expandHome(params.logical as string));
    }
    if (method === "path.inspect") {
      const abs = expandHome(params.logical as string);
      if (!existsSync(abs)) {
        return { missing: true, fingerprint: "" };
      }
      const info = statSync(abs);
      const isDirectory = info.isDirectory();
      let fingerprint = "";
      if (isDirectory) {
        try {
          fingerprint = fingerprintPath(abs);
        } catch {
          fingerprint = "";
        }
      } else if (info.isFile()) {
        fingerprint = fingerprintPath(abs);
      }
      const base = {
        missing: false,
        fingerprint,
        isDirectory,
        size: info.size,
      };
      if (!info.isFile() || info.size > 48_000) return base;
      try {
        const preview = readFileSync(abs, "utf8");
        return { ...base, preview };
      } catch {
        return base;
      }
    }
    if (method === "fs.stat") {
      return statPathWithinHome(String(params.logical ?? ""));
    }
    if (method === "fs.listDir") {
      return listDirWithinHome(String(params.logical ?? "~"));
    }
    if (method === "catalog.pickFolder") {
      const path = await pickFolderDialog();
      return { path };
    }
    if (method === "path.put") {
      const target = expandHome(params.logical as string);
      unpackPath(
        target,
        {
          kind: (params.kind as PathPayload["kind"]) ?? "file",
          contentBase64: params.contentBase64 as string,
          entryName: params.entryName as string | undefined,
        },
        backupDir("remote-path"),
        this.store.root,
      );
      return { ok: true };
    }
    throw new Error(`Método peer desconhecido: ${method}`);
  }
}

export class TlsPeerTransport implements PeerTransport {
  constructor(private readonly identity: DeviceIdentity) {}

  private async request(
    peer: PeerInfo,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const started = Date.now();
    catalogLog("info", "peer RPC enviando", {
      method,
      host: peer.host,
      port: peer.port,
    });

    const socket = await new Promise<TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timeout ao conectar em ${peer.host}:${peer.port} (${method})`,
          ),
        );
      }, PEER_RPC_TIMEOUT_MS);

      const sock = tlsConnect(
        {
          host: peer.host,
          port: peer.port,
          key: this.identity.keyPem,
          cert: this.identity.certPem,
          rejectUnauthorized: false,
        },
        () => {
          clearTimeout(timer);
          resolve(sock);
        },
      );
      sock.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const id = crypto.randomUUID();
    const payload = JSON.stringify({ id, method, params }) + "\n";

    const response = await new Promise<PeerResponse>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new Error(
            `Timeout aguardando resposta de ${peer.host} (${method}, ${PEER_RPC_TIMEOUT_MS}ms)`,
          ),
        );
      }, PEER_RPC_TIMEOUT_MS);

      const finish = (handler: () => void) => {
        clearTimeout(timer);
        handler();
      };

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const idx = buffer.indexOf("\n");
        if (idx >= 0) {
          try {
            const parsed = JSON.parse(buffer.slice(0, idx)) as PeerResponse;
            finish(() => {
              socket.end();
              resolve(parsed);
            });
          } catch (error) {
            finish(() => {
              socket.destroy();
              reject(error);
            });
          }
        }
      });

      socket.on("error", (error) => {
        finish(() => reject(error));
      });

      socket.write(payload);
    });

    catalogLog("info", "peer RPC resposta", {
      method,
      ms: Date.now() - started,
      error: response.error,
    });

    if (response.error) {
      if (response.error === "untrusted peer") {
        throw new Error(
          `${peer.name} não confia nesta máquina — abra EnvSync lá e pareie este PC`,
        );
      }
      throw new Error(response.error);
    }
    return response.result;
  }

  fetchInventory(peer: PeerInfo, itemIds: string[]): Promise<ItemInventory[]> {
    return this.request(peer, "inventory.get", { itemIds }) as Promise<
      ItemInventory[]
    >;
  }

  async remoteInstall(
    peer: PeerInfo,
    manager: PackageManager,
    name: string,
  ): Promise<void> {
    await this.request(peer, "package.install", { manager, name });
  }

  async pushPath(
    peer: PeerInfo,
    localPath: string,
    remoteLogical: string,
  ): Promise<void> {
    const payload = packPath(localPath);
    if (payload.missing) return;
    await this.request(peer, "path.put", {
      logical: remoteLogical,
      kind: payload.kind,
      contentBase64: payload.contentBase64,
      entryName: payload.entryName,
    });
  }

  async pullPath(
    peer: PeerInfo,
    remoteLogical: string,
  ): Promise<string | null> {
    const payload = (await this.request(peer, "path.read", {
      logical: remoteLogical,
    })) as PathPayload;
    if (payload.missing || !payload.contentBase64 || !payload.kind) {
      return null;
    }

    const staging = mkdtempSync(join(tmpdir(), "envsync-pull-"));
    if (payload.kind === "file") {
      const tmp = join(staging, payload.entryName ?? "file");
      writeFileSync(tmp, Buffer.from(payload.contentBase64, "base64"));
      return tmp;
    }

    const archive = join(staging, "payload.tar.gz");
    writeFileSync(archive, Buffer.from(payload.contentBase64, "base64"));
    execFileSync("tar", ["-C", staging, "-xzf", archive]);
    return payload.entryName ? join(staging, payload.entryName) : staging;
  }

  async inspectPath(
    peer: PeerInfo,
    remoteLogical: string,
  ): Promise<PathInspectResult> {
    return (await this.request(peer, "path.inspect", {
      logical: remoteLogical,
    })) as PathInspectResult;
  }

  statRemotePath(peer: PeerInfo, remoteLogical: string): Promise<PathStatResult> {
    return this.request(peer, "fs.stat", { logical: remoteLogical }) as Promise<PathStatResult>;
  }

  fetchCatalogSnapshot(
    peer: PeerInfo,
    requester: CatalogRequester,
  ): Promise<CatalogSnapshot> {
    return this.request(peer, "catalog.snapshot", {
      requesterName: requester.deviceName,
      requesterFingerprint: requester.fingerprint,
    }) as Promise<CatalogSnapshot>;
  }

  listRemoteDir(peer: PeerInfo, logical: string): Promise<RemoteDirListing> {
    return this.request(peer, "fs.listDir", { logical }) as Promise<RemoteDirListing>;
  }

  async pickRemoteFolder(peer: PeerInfo): Promise<string | null> {
    const result = (await this.request(peer, "catalog.pickFolder", {})) as {
      path?: string | null;
    };
    return result.path?.trim() || null;
  }

  async pushEnv(
    peer: PeerInfo,
    keys: string[],
    values: Record<string, string>,
  ): Promise<void> {
    await this.request(peer, "env.put", { keys, values });
  }

  async pullEnv(
    peer: PeerInfo,
    keys: string[],
  ): Promise<Record<string, string>> {
    return (await this.request(peer, "env.get", { keys })) as Record<
      string,
      string
    >;
  }
}
