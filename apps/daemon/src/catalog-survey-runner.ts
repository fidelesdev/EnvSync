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
import { catalogLog } from "./catalog-log.js";
import { buildLocalInventory } from "./inventory.js";
import { notifyDesktop } from "./notify.js";
import type { PeerTransport } from "./peer-client.js";
import type { DaemonStore } from "./store.js";

const BATCH_SIZE = 12;

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

function orderItemsForSurvey(items: CatalogItem[]): CatalogItem[] {
  const priority = (item: CatalogItem): number => {
    if (item.id.startsWith("custom:")) return 0;
    if (!item.id.startsWith("auto:")) return 1;
    return 2;
  };
  return [...items].sort((left, right) => {
    const diff = priority(left) - priority(right);
    if (diff !== 0) return diff;
    return left.label.localeCompare(right.label);
  });
}

export class CatalogSurveyRunner {
  private readonly jobs = new Map<string, CatalogSurveyProgress>();
  private readonly running = new Set<string>();

  constructor(
    private readonly store: DaemonStore,
    private readonly peerTransport: PeerTransport,
    private readonly localFingerprint: string,
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
    const localName = this.store.getDeviceName();
    const startedAt = Date.now();

    try {
      const peer = this.store.listDiscovered().find((entry) => entry.id === peerId);
      if (!peer) {
        throw new Error("Dispositivo não encontrado na rede (mDNS)");
      }
      if (!peer.trusted) {
        throw new Error("Dispositivo não pareado — pareie antes de consultar o catálogo");
      }

      const trustedLocal = this.store.listTrusted().map((entry) => entry.fingerprint);
      catalogLog("info", "survey iniciado", {
        local: localName,
        peer: peer.name,
        peerHost: `${peer.host}:${peer.port}`,
        peerFingerprint: peer.fingerprint.slice(0, 16),
        trustedCount: trustedLocal.length,
      });

      void notifyDesktop(
        "EnvSync",
        `Consultando catálogo de ${peer.name} (${peer.host})…`,
      );
      this.store.addActivity("catalog", `Consulta iniciada: ${peer.name}`);

      this.update(peerId, { phase: "Descobrindo pacotes nesta máquina…" });
      const localStarted = Date.now();
      const localCatalog = await buildEffectiveCatalog(this.store.getCatalogState());
      catalogLog("info", "catálogo local montado", {
        ms: Date.now() - localStarted,
        items: localCatalog.items.length,
      });

      this.update(peerId, {
        phase: `Consultando ${peer.name} (${peer.host})…`,
      });
      catalogLog("info", "solicitando catalog.snapshot no peer", {
        peer: peer.name,
        host: peer.host,
        port: peer.port,
      });

      const remoteStarted = Date.now();
      const remoteSnapshot = await this.peerTransport.fetchCatalogSnapshot(peer, {
        deviceName: localName,
        fingerprint: this.localFingerprint,
      });
      catalogLog("info", "catalog.snapshot recebido", {
        ms: Date.now() - remoteStarted,
        peer: remoteSnapshot.deviceName,
        items: remoteSnapshot.items.length,
      });

      const unionItems = orderItemsForSurvey(
        mergeItemDefinitions([
          ...localCatalog.items,
          ...(remoteSnapshot.items as CatalogItem[]),
        ]),
      );

      const peerName = remoteSnapshot.deviceName || peer.name;
      const identified: CatalogSurveyItem[] = [];
      const total = unionItems.length;

      catalogLog("info", "inventário cruzado", { totalItems: total });

      this.update(peerId, {
        phase: `Identificando itens… (0/${total})`,
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
        const batchStarted = Date.now();

        let localRows;
        let remoteRows;
        try {
          localRows = await buildLocalInventory(catalogForInventory, batchIds);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          catalogLog("error", "falha inventário local", {
            offset,
            batchSize: batchIds.length,
            error: message,
          });
          throw error;
        }

        try {
          remoteRows = await this.peerTransport.fetchInventory(peer, batchIds);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          catalogLog("error", "falha inventário remoto", {
            offset,
            batchSize: batchIds.length,
            peer: peer.host,
            error: message,
          });
          throw new Error(
            `Falha ao consultar inventário em ${peer.name}: ${message}`,
          );
        }

        catalogLog("info", "lote inventário OK", {
          offset,
          batchSize: batchIds.length,
          ms: Date.now() - batchStarted,
        });

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

        if (offset === 0 && identified.length > 0) {
          catalogLog("info", "primeiros itens identificados", {
            count: identified.length,
          });
        }
      }

      const survey: CatalogSurvey = {
        deviceName: localName,
        peerDeviceName: peerName,
        groups: localCatalog.groups,
        sections: buildSections(identified, localName, peerName),
      };

      catalogLog("info", "survey concluído", {
        ms: Date.now() - startedAt,
        identified: identified.length,
        total,
      });

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
      this.store.addActivity(
        "catalog",
        `Consulta concluída: ${identified.length} itens (${peer.name})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      catalogLog("error", "survey falhou", {
        ms: Date.now() - startedAt,
        peerId: peerId.slice(0, 16),
        error: message,
      });
      void notifyDesktop("EnvSync — erro no catálogo", message);
      this.store.addActivity("catalog", `Consulta falhou: ${message}`);
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
