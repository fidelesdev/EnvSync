import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DEFAULT_CATALOG, type Catalog } from "@envsync/catalog";
import { dataDir } from "@envsync/core";
import type { ActivityEntry, PeerInfo, SyncPlan } from "@envsync/protocol";

export type TrustedPeer = {
  id: string;
  name: string;
  fingerprint: string;
};

export type DaemonStoreData = {
  deviceName: string;
  selectedItemIds: string[];
  trustedPeers: TrustedPeer[];
  activity: ActivityEntry[];
  catalogOverlay: Catalog | null;
};

const defaultStore = (): DaemonStoreData => ({
  deviceName: process.env.HOSTNAME ?? "envsync-device",
  selectedItemIds: [],
  trustedPeers: [],
  activity: [],
  catalogOverlay: null,
});

export class DaemonStore {
  readonly root: string;
  private data: DaemonStoreData;
  private plans = new Map<string, SyncPlan>();
  private discovered = new Map<string, PeerInfo>();

  constructor(root = dataDir()) {
    this.root = root;
    mkdirSync(this.root, { recursive: true });
    this.data = this.load();
  }

  private storePath(): string {
    return join(this.root, "store.json");
  }

  private load(): DaemonStoreData {
    const path = this.storePath();
    if (!existsSync(path)) return defaultStore();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DaemonStoreData;
    return { ...defaultStore(), ...parsed };
  }

  save(): void {
    writeFileSync(this.storePath(), JSON.stringify(this.data, null, 2));
  }

  getCatalog(): Catalog {
    return this.data.catalogOverlay ?? DEFAULT_CATALOG;
  }

  getSelected(): string[] {
    return [...this.data.selectedItemIds];
  }

  setSelected(ids: string[]): void {
    this.data.selectedItemIds = [...new Set(ids)];
    this.save();
  }

  getDeviceName(): string {
    return this.data.deviceName;
  }

  setDeviceName(name: string): void {
    this.data.deviceName = name;
    this.save();
  }

  listTrusted(): TrustedPeer[] {
    return [...this.data.trustedPeers];
  }

  trustPeer(peer: TrustedPeer): void {
    this.data.trustedPeers = [
      ...this.data.trustedPeers.filter((entry) => entry.fingerprint !== peer.fingerprint),
      peer,
    ];
    this.save();
  }

  untrustPeer(fingerprint: string): void {
    this.data.trustedPeers = this.data.trustedPeers.filter(
      (entry) => entry.fingerprint !== fingerprint,
    );
    this.save();
  }

  isTrusted(fingerprint: string): boolean {
    return this.data.trustedPeers.some((entry) => entry.fingerprint === fingerprint);
  }

  addActivity(kind: string, message: string): ActivityEntry {
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      kind,
      message,
    };
    this.data.activity = [entry, ...this.data.activity].slice(0, 200);
    this.save();
    return entry;
  }

  listActivity(): ActivityEntry[] {
    return [...this.data.activity];
  }

  savePlan(plan: SyncPlan): void {
    this.plans.set(plan.id, plan);
  }

  getPlan(id: string): SyncPlan | undefined {
    return this.plans.get(id);
  }

  updatePlan(plan: SyncPlan): void {
    this.plans.set(plan.id, plan);
  }

  upsertDiscovered(peer: PeerInfo): void {
    this.discovered.set(peer.id, peer);
  }

  removeDiscovered(id: string): void {
    this.discovered.delete(id);
  }

  listDiscovered(): PeerInfo[] {
    return [...this.discovered.values()].map((peer) => ({
      ...peer,
      trusted: this.isTrusted(peer.fingerprint),
    }));
  }
}
