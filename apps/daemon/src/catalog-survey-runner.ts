import {
  buildEffectiveCatalog,
  mergeItemDefinitions,
  type CatalogItem,
} from "@envsync/catalog";
import type {
  CatalogSurvey,
  CatalogSurveyItem,
  CatalogSurveyProgress,
  CatalogSurveySection,
} from "@envsync/protocol";
import { buildLocalInventory } from "./inventory.js";
import type { PeerTransport } from "./peer-client.js";
import type { DaemonStore } from "./store.js";

const BATCH_SIZE = 6;

function itemSource(item: CatalogItem): "seed" | "discovered" | "custom" {
  if (item.id.startsWith("auto:")) return "discovered";
  if (item.id.startsWith("custom:")) return "custom";
  return "seed";
}

function buildSections(
  items: CatalogSurveyItem[],
  localName: string,
  peerName: string,
): CatalogSurveySection[] {
  return [
    {
      id: "remoteOnly",
      title: `Só em ${peerName}`,
      items: items.filter((item) => item.remotePresent && !item.localPresent),
    },
    {
      id: "both",
      title: `Em ambos (${localName} e ${peerName})`,
      items: items.filter((item) => item.localPresent && item.remotePresent),
    },
    {
      id: "localOnly",
      title: `Só em ${localName}`,
      items: items.filter((item) => item.localPresent && !item.remotePresent),
    },
  ];
}

function emptyProgress(peerId: string): CatalogSurveyProgress {
  return {
    peerId,
    status: "idle",
    phase: "Aguardando",
    processed: 0,
    total: 0,
    identifiedCount: 0,
    identified: [],
    sections: [],
    survey: null,
    updatedAt: new Date().toISOString(),
  };
}

export class CatalogSurveyRunner {
  private readonly jobs = new Map<string, CatalogSurveyProgress>();
  private readonly running = new Set<string>();

  constructor(
    private readonly store: DaemonStore,
    private readonly peerTransport: PeerTransport,
  ) {}

  getProgress(peerId: string): CatalogSurveyProgress {
    return this.jobs.get(peerId) ?? emptyProgress(peerId);
  }

  restartSurvey(peerId: string): CatalogSurveyProgress {
    this.running.delete(peerId);
    this.jobs.delete(peerId);
    return this.startSurvey(peerId);
  }

  ensureSurvey(peerId: string): CatalogSurveyProgress {
    const current = this.getProgress(peerId);
    if (current.status === "running") return current;
    if (current.status === "done" && current.survey) {
      const age = Date.now() - new Date(current.updatedAt).getTime();
      if (age < 60_000) return current;
    }
    void this.startSurvey(peerId);
    return this.getProgress(peerId);
  }

  startSurvey(peerId: string): CatalogSurveyProgress {
    if (this.running.has(peerId)) {
      return this.getProgress(peerId);
    }

    const initial: CatalogSurveyProgress = {
      peerId,
      status: "running",
      phase: "Preparando catálogo local…",
      processed: 0,
      total: 0,
      identifiedCount: 0,
      identified: [],
      sections: [],
      survey: null,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(peerId, initial);
    void this.run(peerId);
    return initial;
  }

  private update(peerId: string, patch: Partial<CatalogSurveyProgress>): void {
    const current = this.getProgress(peerId);
    this.jobs.set(peerId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  private async run(peerId: string): Promise<void> {
    if (this.running.has(peerId)) return;
    this.running.add(peerId);

    try {
      const peer = this.store.listDiscovered().find((entry) => entry.id === peerId);
      if (!peer) throw new Error("Dispositivo não encontrado");
      if (!peer.trusted) throw new Error("Dispositivo não pareado");

      this.update(peerId, { phase: "Descobrindo pacotes nesta máquina…" });
      const localCatalog = await buildEffectiveCatalog(this.store.getCatalogState());

      this.update(peerId, { phase: "Consultando catálogo do outro dispositivo…" });
      const remoteSnapshot = await this.peerTransport.fetchCatalogSnapshot(peer);
      const unionItems = mergeItemDefinitions([
        ...localCatalog.items,
        ...(remoteSnapshot.items as CatalogItem[]),
      ]);

      const localName = this.store.getDeviceName();
      const peerName = remoteSnapshot.deviceName || peer.name;
      const identified: CatalogSurveyItem[] = [];
      const total = unionItems.length;

      this.update(peerId, {
        phase: "Identificando itens…",
        total,
        processed: 0,
        identified,
        identifiedCount: 0,
        sections: buildSections(identified, localName, peerName),
      });

      const catalogForInventory = { ...localCatalog, items: unionItems };

      for (let offset = 0; offset < unionItems.length; offset += BATCH_SIZE) {
        const batch = unionItems.slice(offset, offset + BATCH_SIZE);
        const batchIds = batch.map((item) => item.id);

        const localRows = await buildLocalInventory(catalogForInventory, batchIds);
        const remoteRows = await this.peerTransport.fetchInventory(peer, batchIds);
        const localMap = new Map(localRows.map((row) => [row.itemId, row]));
        const remoteMap = new Map(remoteRows.map((row) => [row.itemId, row]));

        for (const item of batch) {
          const local = localMap.get(item.id);
          const remote = remoteMap.get(item.id);
          const localPresent = local?.presence === "present";
          const remotePresent = remote?.presence === "present";

          if (!localPresent && !remotePresent) continue;

          const inSync =
            localPresent &&
            remotePresent &&
            Boolean(local?.fingerprint) &&
            local?.fingerprint === remote?.fingerprint;

          identified.push({
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

        const processed = Math.min(offset + batch.length, total);
        this.update(peerId, {
          phase: `Identificando itens… (${processed}/${total})`,
          processed,
          identified: [...identified],
          identifiedCount: identified.length,
          sections: buildSections(identified, localName, peerName),
        });
      }

      const survey: CatalogSurvey = {
        deviceName: localName,
        peerDeviceName: peerName,
        groups: localCatalog.groups,
        sections: buildSections(identified, localName, peerName),
      };

      this.update(peerId, {
        status: "done",
        phase: "Concluído",
        processed: total,
        identifiedCount: identified.length,
        identified: [...identified],
        sections: survey.sections,
        survey,
        error: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update(peerId, {
        status: "error",
        phase: "Erro",
        error: message,
      });
    } finally {
      this.running.delete(peerId);
    }
  }
}
