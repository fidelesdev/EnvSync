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
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { PackageManager } from "@envsync/catalog";
import { backupDir, expandHome, type ItemInventory } from "@envsync/core";
import { envPlugin, filesPlugin, getPlugin } from "@envsync/plugins";
import type { PeerInfo } from "@envsync/protocol";
import type { DeviceIdentity } from "./identity.js";
import { buildLocalInventory, readManagedEnvValues } from "./inventory.js";
import type { PeerTransport } from "./peer-client.js";
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

function peerFingerprint(socket: TLSSocket): string {
  const cert = socket.getPeerCertificate();
  if (cert && typeof cert.fingerprint256 === "string") {
    return cert.fingerprint256.replace(/:/g, "").toLowerCase();
  }
  return "";
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
    if (!peerFp || !this.store.isTrusted(peerFp)) {
      socket.write(JSON.stringify({ id: "0", error: "untrusted peer" }) + "\n");
      socket.destroy();
      return;
    }

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
    try {
      const req = JSON.parse(line) as PeerRequest;
      const result = await this.handleMethod(req.method, req.params ?? {});
      const response: PeerResponse = { id: req.id, result };
      socket.write(JSON.stringify(response) + "\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      socket.write(JSON.stringify({ id: "?", error: message }) + "\n");
    }
  }

  private async handleMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "inventory.get") {
      const itemIds = params.itemIds as string[];
      return buildLocalInventory(this.store.getCatalog(), itemIds);
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
    const socket = await new Promise<TLSSocket>((resolve, reject) => {
      const sock = tlsConnect(
        {
          host: peer.host,
          port: peer.port,
          key: this.identity.keyPem,
          cert: this.identity.certPem,
          rejectUnauthorized: false,
        },
        () => resolve(sock),
      );
      sock.on("error", reject);
    });

    const id = crypto.randomUUID();
    socket.write(JSON.stringify({ id, method, params }) + "\n");

    const response = await new Promise<PeerResponse>((resolve, reject) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const idx = buffer.indexOf("\n");
        if (idx >= 0) {
          try {
            resolve(JSON.parse(buffer.slice(0, idx)) as PeerResponse);
          } catch (error) {
            reject(error);
          } finally {
            socket.end();
          }
        }
      });
      socket.on("error", reject);
    });

    if (response.error) throw new Error(response.error);
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
