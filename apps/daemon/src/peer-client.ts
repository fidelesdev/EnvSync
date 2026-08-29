import type { CatalogSnapshot, PeerInfo } from "@envsync/protocol";
import type { ItemInventory } from "@envsync/core";
import type { PackageManager } from "@envsync/catalog";

export type PathInspectResult = {
  missing: boolean;
  fingerprint: string;
  isDirectory?: boolean;
  size?: number;
  preview?: string;
};

export type CatalogRequester = {
  deviceName: string;
  fingerprint: string;
};

export type PeerTransport = {
  fetchInventory(peer: PeerInfo, itemIds: string[]): Promise<ItemInventory[]>;
  remoteInstall(
    peer: PeerInfo,
    manager: PackageManager,
    name: string,
  ): Promise<void>;
  pushPath(peer: PeerInfo, localPath: string, remoteLogical: string): Promise<void>;
  /** Retorna caminho local temporário, ou null se o remoto não tiver o path. */
  pullPath(peer: PeerInfo, remoteLogical: string): Promise<string | null>;
  inspectPath(peer: PeerInfo, remoteLogical: string): Promise<PathInspectResult>;
  fetchCatalogSnapshot(
    peer: PeerInfo,
    requester: CatalogRequester,
  ): Promise<CatalogSnapshot>;
  pushEnv(
    peer: PeerInfo,
    keys: string[],
    values: Record<string, string>,
  ): Promise<void>;
  pullEnv(peer: PeerInfo, keys: string[]): Promise<Record<string, string>>;
};

/** Local loopback transport for tests / single-machine dry runs */
export class LoopbackPeerTransport implements PeerTransport {
  constructor(
    private readonly inventoryProvider: (
      itemIds: string[],
    ) => Promise<ItemInventory[]>,
  ) {}

  fetchInventory(_peer: PeerInfo, itemIds: string[]): Promise<ItemInventory[]> {
    return this.inventoryProvider(itemIds);
  }

  async remoteInstall(): Promise<void> {
    // no-op in loopback
  }

  async pushPath(): Promise<void> {}

  async pullPath(_peer: PeerInfo, remoteLogical: string): Promise<string | null> {
    const expanded = remoteLogical.replace(/^~/, process.env.HOME ?? "");
    return expanded;
  }

  async inspectPath(_peer: PeerInfo, remoteLogical: string): Promise<PathInspectResult> {
    const expanded = remoteLogical.replace(/^~/, process.env.HOME ?? "");
    return {
      missing: false,
      fingerprint: "loopback",
      preview: undefined,
      size: 0,
    };
  }

  async fetchCatalogSnapshot(
    _peer: PeerInfo,
    _requester: CatalogRequester,
  ): Promise<CatalogSnapshot> {
    return { deviceName: "loopback", items: [] };
  }

  async pushEnv(): Promise<void> {}

  async pullEnv(
    _peer: PeerInfo,
    keys: string[],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const key of keys) result[key] = "";
    return result;
  }
}
