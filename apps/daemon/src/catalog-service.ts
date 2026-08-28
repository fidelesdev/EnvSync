import {
  buildEffectiveCatalog,
  customPathItem,
  mergeItemDefinitions,
  type Catalog,
  type CatalogItem,
  type CatalogState,
} from "@envsync/catalog";
import { existsSync } from "node:fs";
import { expandHome } from "@envsync/core";
import { buildLocalInventory } from "./inventory.js";
import type { PeerTransport } from "./peer-client.js";
import type { DaemonStore } from "./store.js";
import type { CatalogSurvey, CatalogSurveyItem } from "@envsync/protocol";

function itemSource(item: CatalogItem): "seed" | "discovered" | "custom" {
  if (item.id.startsWith("auto:")) return "discovered";
  if (item.id.startsWith("custom:")) return "custom";
  return "seed";
}

function indexInventory(
  rows: Awaited<ReturnType<typeof buildLocalInventory>>,
): Map<string, (typeof rows)[number]> {
  return new Map(rows.map((row) => [row.itemId, row]));
}

export class CatalogService {
  constructor(
    private readonly store: DaemonStore,
    private readonly peerTransport: PeerTransport,
  ) {}

  getCatalogState(): CatalogState {
    return this.store.getCatalogState();
  }

  async getEffectiveCatalog(): Promise<Catalog> {
    return buildEffectiveCatalog(this.getCatalogState());
  }

  async getSnapshot(): Promise<{ deviceName: string; items: CatalogItem[] }> {
    const catalog = await this.getEffectiveCatalog();
    return {
      deviceName: this.store.getDeviceName(),
      items: catalog.items,
    };
  }

  async addCustomPath(label: string, path: string): Promise<Catalog> {
    const normalized = path.trim();
    const abs = expandHome(normalized);
    if (!existsSync(abs)) {
      throw new Error(`Pasta não encontrada: ${normalized}`);
    }
    const item = customPathItem(label, normalized);
    this.store.addCustomItem(item);
    return this.getEffectiveCatalog();
  }

  async removeItem(itemId: string): Promise<Catalog> {
    if (itemId.startsWith("custom:")) {
      this.store.removeCustomItem(itemId);
    } else {
      this.store.hideCatalogItem(itemId);
    }
    const selected = this.store.getSelected().filter((id) => id !== itemId);
    this.store.setSelected(selected);
    return this.getEffectiveCatalog();
  }

  async survey(peerId: string): Promise<CatalogSurvey> {
    const peer = this.store.listDiscovered().find((entry) => entry.id === peerId);
    if (!peer) throw new Error("Selecione um dispositivo pareado");
    if (!peer.trusted) throw new Error("Pareie o dispositivo antes de ver o catálogo");

    const localCatalog = await this.getEffectiveCatalog();
    const remoteSnapshot = await this.peerTransport.fetchCatalogSnapshot(peer);
    const unionItems = mergeItemDefinitions([
      ...localCatalog.items,
      ...(remoteSnapshot.items as CatalogItem[]),
    ]);

    const itemIds = unionItems.map((item) => item.id);
    const localRows = indexInventory(
      await buildLocalInventory({ ...localCatalog, items: unionItems }, itemIds),
    );
    const remoteRows = indexInventory(
      await this.peerTransport.fetchInventory(peer, itemIds),
    );

    const surveyItems: CatalogSurveyItem[] = [];

    for (const item of unionItems) {
      const local = localRows.get(item.id);
      const remote = remoteRows.get(item.id);
      const localPresent = local?.presence === "present";
      const remotePresent = remote?.presence === "present";

      if (!localPresent && !remotePresent) continue;

      const inSync =
        localPresent &&
        remotePresent &&
        Boolean(local?.fingerprint) &&
        local?.fingerprint === remote?.fingerprint;

      surveyItems.push({
        id: item.id,
        label: item.label,
        groupId: item.groupId,
        source: itemSource(item),
        localPresent,
        remotePresent,
        inSync,
        detail: localPresent ? local?.detail : remote?.detail,
      });
    }

    const localName = this.store.getDeviceName();
    const peerName = remoteSnapshot.deviceName || peer.name;

    const remoteOnly = surveyItems.filter(
      (item) => item.remotePresent && !item.localPresent,
    );
    const localOnly = surveyItems.filter(
      (item) => item.localPresent && !item.remotePresent,
    );
    const both = surveyItems.filter(
      (item) => item.localPresent && item.remotePresent,
    );

    return {
      deviceName: localName,
      peerDeviceName: peerName,
      groups: localCatalog.groups,
      sections: [
        {
          id: "remoteOnly",
          title: `Só em ${peerName}`,
          items: remoteOnly,
        },
        {
          id: "both",
          title: `Em ambos (${localName} e ${peerName})`,
          items: both,
        },
        {
          id: "localOnly",
          title: `Só em ${localName}`,
          items: localOnly,
        },
      ],
    };
  }
}
