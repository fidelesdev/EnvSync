import {
  buildEffectiveCatalog,
  customPathItem,
  type Catalog,
  type CatalogItem,
  type CatalogState,
} from "@envsync/catalog";
import type { CatalogSurvey, CatalogSurveyProgress } from "@envsync/protocol";
import { existsSync } from "node:fs";
import { expandHome } from "@envsync/core";
import { CatalogSurveyRunner } from "./catalog-survey-runner.js";
import { pickFolderDialog } from "./folder-picker.js";
import type { PeerTransport } from "./peer-client.js";
import type { DaemonStore } from "./store.js";

export class CatalogService {
  readonly runner: CatalogSurveyRunner;

  constructor(
    private readonly store: DaemonStore,
    peerTransport: PeerTransport,
  ) {
    this.runner = new CatalogSurveyRunner(store, peerTransport);
  }

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

  async pickFolder(): Promise<{ path: string | null }> {
    const path = await pickFolderDialog();
    return { path };
  }

  async addCustomPath(label: string, path: string): Promise<Catalog> {
    const normalized = path.trim();
    const abs = expandHome(normalized);
    if (!existsSync(abs)) {
      throw new Error(`Pasta não encontrada: ${normalized}`);
    }
    const item = customPathItem(label, normalized);
    this.store.addCustomItem(item);
    const peerId = this.store.getSelectedPeerId();
    if (peerId) this.runner.restartSurvey(peerId);
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
    const peerId = this.store.getSelectedPeerId();
    if (peerId) this.runner.restartSurvey(peerId);
    return this.getEffectiveCatalog();
  }

  ensureSurvey(peerId: string): CatalogSurveyProgress {
    return this.runner.ensureSurvey(peerId);
  }

  startSurvey(peerId: string): CatalogSurveyProgress {
    return this.runner.startSurvey(peerId);
  }

  getSurveyProgress(peerId: string): CatalogSurveyProgress {
    return this.runner.getProgress(peerId);
  }

  async survey(peerId: string): Promise<CatalogSurvey> {
    const progress = this.runner.getProgress(peerId);
    if (progress.status === "done" && progress.survey) {
      return progress.survey;
    }
    if (progress.status === "running") {
      throw new Error("Catálogo ainda está sendo identificado");
    }
    this.runner.startSurvey(peerId);
    throw new Error("Catálogo ainda está sendo identificado");
  }

  bootstrapSurveys(): void {
    const selected = this.store.getSelectedPeerId();
    if (selected) this.runner.ensureSurvey(selected);

    for (const trusted of this.store.listTrusted()) {
      const peer = this.store
        .listDiscovered()
        .find((entry) => entry.fingerprint === trusted.fingerprint);
      if (peer?.online && peer.trusted) {
        this.runner.ensureSurvey(peer.id);
      }
    }
  }
}
