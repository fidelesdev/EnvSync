import {
  buildEffectiveCatalog,
  customPathItem,
  type Catalog,
  type CatalogItem,
  type CatalogState,
} from "@envsync/catalog";
import type {
  CatalogSurvey,
  CatalogSurveyProgress,
  RemoteDirListing,
} from "@envsync/protocol";
import { existsSync, statSync } from "node:fs";
import { expandHome } from "@envsync/core";
import { CatalogSurveyRunner } from "./catalog-survey-runner.js";
import { pickFolderDialog } from "./folder-picker.js";
import type { CatalogRequester, PeerTransport } from "./peer-client.js";
import type { DaemonStore } from "./store.js";
import { catalogLog } from "./catalog-log.js";
import { notifyDesktop } from "./notify.js";

export class CatalogService {
  readonly runner: CatalogSurveyRunner;

  constructor(
    private readonly store: DaemonStore,
    private readonly peerTransport: PeerTransport,
    localFingerprint: string,
  ) {
    this.runner = new CatalogSurveyRunner(store, peerTransport, localFingerprint);
  }

  private resolvePeer(peerId: string) {
    const peer = this.store.listDiscovered().find((entry) => entry.id === peerId);
    if (!peer) {
      throw new Error("Dispositivo não encontrado na rede (mDNS)");
    }
    if (!peer.trusted) {
      throw new Error("Dispositivo não pareado — pareie antes de navegar pastas");
    }
    if (!peer.online) {
      throw new Error(`${peer.name} está offline`);
    }
    return peer;
  }

  getCatalogState(): CatalogState {
    return this.store.getCatalogState();
  }

  async getEffectiveCatalog(): Promise<Catalog> {
    return buildEffectiveCatalog(this.getCatalogState());
  }

  async getSnapshot(requester?: CatalogRequester): Promise<{
    deviceName: string;
    items: CatalogItem[];
  }> {
    const started = Date.now();
    if (requester) {
      catalogLog("info", "catalog.snapshot atendendo pedido remoto", {
        requester: requester.deviceName,
        requesterFp: requester.fingerprint.slice(0, 16),
      });
      void notifyDesktop(
        "EnvSync",
        `${requester.deviceName} está consultando o catálogo desta máquina`,
      );
      this.store.addActivity(
        "catalog",
        `Catálogo consultado por ${requester.deviceName}`,
      );
    }
    const catalog = await this.getEffectiveCatalog();
    if (requester) {
      catalogLog("info", "catalog.snapshot pronto", {
        ms: Date.now() - started,
        items: catalog.items.length,
      });
    }
    return {
      deviceName: this.store.getDeviceName(),
      items: catalog.items,
    };
  }

  async listRemoteDir(peerId: string, path: string): Promise<RemoteDirListing> {
    const peer = this.resolvePeer(peerId);
    const logical = path.trim() || "~";
    return this.peerTransport.listRemoteDir(peer, logical);
  }

  async pickRemoteFolder(peerId: string): Promise<{ path: string | null }> {
    const peer = this.resolvePeer(peerId);
    const path = await this.peerTransport.pickRemoteFolder(peer);
    return { path };
  }

  async pickFolder(): Promise<{ path: string | null }> {
    const path = await pickFolderDialog();
    return { path };
  }

  async addCustomPath(
    label: string,
    path: string,
    peerId?: string,
  ): Promise<Catalog> {
    const normalized = path.trim();
    if (!normalized) throw new Error("Informe o caminho da pasta");

    if (peerId) {
      const peer = this.resolvePeer(peerId);
      const stat = await this.peerTransport.statRemotePath(peer, normalized);
      if (stat.missing) {
        throw new Error(`Pasta não encontrada em ${peer.name}: ${normalized}`);
      }
      if (!stat.isDirectory) {
        throw new Error(`Caminho não é uma pasta em ${peer.name}: ${normalized}`);
      }
    } else {
      const abs = expandHome(normalized);
      if (!existsSync(abs)) {
        throw new Error(`Pasta não encontrada: ${normalized}`);
      }
      if (!statSync(abs).isDirectory()) {
        throw new Error(`Caminho não é uma pasta: ${normalized}`);
      }
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

  getSurveyProgress(peerId: string): CatalogSurveyProgress {
    return this.runner.getProgress(peerId);
  }

  ensureSurvey(peerId: string): CatalogSurveyProgress {
    return this.runner.ensureSurvey(peerId);
  }

  startSurvey(peerId: string): CatalogSurveyProgress {
    return this.runner.startSurvey(peerId);
  }

  async survey(peerId: string): Promise<CatalogSurvey> {
    const progress = this.runner.getProgress(peerId);
    if (progress.status === "done" && progress.survey) {
      return progress.survey;
    }
    if (progress.status === "running") {
      throw new Error("Catálogo ainda está sendo identificado");
    }
    throw new Error("Nenhuma busca concluída — inicie manualmente em Catálogo");
  }
}
