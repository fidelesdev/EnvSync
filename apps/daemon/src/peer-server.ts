import {
  createServer as createTlsServer,
  connect as tlsConnect,
  type TLSSocket,
} from "node:tls";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function peerFingerprint(socket: TLSSocket): string {
  const cert = socket.getPeerCertificate();
  if (cert && typeof cert.fingerprint256 === "string") {
    return cert.fingerprint256.replace(/:/g, "").toLowerCase();
  }
  return "";
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
      const path = expandHome(params.logical as string);
      if (!existsSync(path)) throw new Error("path missing");
      if (statSync(path).isDirectory()) {
        throw new Error("diretório não suportado no transporte MVP");
      }
      return { contentBase64: readFileSync(path).toString("base64") };
    }
    if (method === "path.put") {
      const target = expandHome(params.logical as string);
      const tmp = join(mkdtempSync(join(tmpdir(), "envsync-put-")), "payload");
      writeFileSync(tmp, Buffer.from(params.contentBase64 as string, "base64"));
      await filesPlugin.apply({
        direction: "pull",
        sourcePath: tmp,
        targetPath: target,
        ctx: { dataDir: this.store.root, backupRoot: backupDir("remote-path") },
        confirmed: true,
      });
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
    if (!existsSync(localPath)) {
      throw new Error(`Arquivo local ausente: ${localPath}`);
    }
    if (statSync(localPath).isDirectory()) {
      throw new Error(
        "Sync de diretórios via base64 não suportado no MVP; use arquivos únicos",
      );
    }
    const contentBase64 = readFileSync(localPath).toString("base64");
    await this.request(peer, "path.put", {
      logical: remoteLogical,
      contentBase64,
    });
  }

  async pullPath(peer: PeerInfo, remoteLogical: string): Promise<string> {
    const content = (await this.request(peer, "path.read", {
      logical: remoteLogical,
    })) as { contentBase64: string };
    const dir = mkdtempSync(join(tmpdir(), "envsync-pull-"));
    const tmp = join(dir, "file");
    writeFileSync(tmp, Buffer.from(content.contentBase64, "base64"));
    return tmp;
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
