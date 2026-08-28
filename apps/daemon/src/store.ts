import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DEFAULT_CATALOG, type Catalog, type CatalogItem, type CatalogState, EMPTY_CATALOG_STATE } from "@envsync/catalog";
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
  selectedPeerId: string;
  trustedPeers: TrustedPeer[];
  activity: ActivityEntry[];
  /** @deprecated legado — migrado para catalogState */
  catalogOverlay: Catalog | null;
  catalogState: CatalogState | null;
};

const defaultStore = (): DaemonStoreData => ({
  deviceName: process.env.HOSTNAME ?? "envsync-device",
  selectedItemIds: [],
  selectedPeerId: "",
  trustedPeers: [],
  activity: [],
  catalogOverlay: null,
  catalogState: null,
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
    const merged = { ...defaultStore(), ...parsed };
    if (!merged.catalogState && merged.catalogOverlay) {
      merged.catalogState = {
        customItems: merged.catalogOverlay.items.filter(
          (item) => !DEFAULT_CATALOG.items.some((seed) => seed.id === item.id),
        ),
        hiddenItemIds: [],
      };
    }
    return merged;
  }

  save(): void {
    writeFileSync(this.storePath(), JSON.stringify(this.data, null, 2));
  }

  getCatalogState(): CatalogState {
    return this.data.catalogState ?? EMPTY_CATALOG_STATE;
  }

  private persistCatalogState(state: CatalogState): void {
    this.data.catalogState = state;
    this.save();
  }

  addCustomItem(item: CatalogItem): void {
    const state = this.getCatalogState();
    const customItems = [
      ...state.customItems.filter((entry) => entry.id !== item.id),
      item,
    ];
    this.persistCatalogState({ ...state, customItems });
    this.addActivity("catalog", `Pasta adicionada: ${item.label}`);
  }

  removeCustomItem(itemId: string): void {
    const state = this.getCatalogState();
    this.persistCatalogState({
      ...state,
      customItems: state.customItems.filter((item) => item.id !== itemId),
    });
    this.addActivity("catalog", `Pasta removida: ${itemId}`);
  }

  hideCatalogItem(itemId: string): void {
    const state = this.getCatalogState();
    const hiddenItemIds = [...new Set([...state.hiddenItemIds, itemId])];
    this.persistCatalogState({ ...state, hiddenItemIds });
    this.addActivity("catalog", `Item oculto: ${itemId}`);
  }

  getSelected(): string[] {
    return [...this.data.selectedItemIds];
  }

  setSelected(ids: string[]): void {
    this.data.selectedItemIds = [...new Set(ids)];
    this.save();
  }

  getSelectedPeerId(): string {
    return this.data.selectedPeerId ?? "";
  }

  setSelectedPeerId(peerId: string): void {
    this.data.selectedPeerId = peerId;
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
