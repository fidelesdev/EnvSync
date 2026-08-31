import { mkdirSync, existsSync } from "node:fs";
import type { CatalogItem } from "@envsync/catalog";
import {
  backupDir,
  buildPlan,
  expandHome,
  markPlanConfirmed,
  type ItemInventory,
} from "@envsync/core";
import {
  envPlugin,
  filesPlugin,
  getPlugin,
} from "@envsync/plugins";
import type { ConflictChoice, SyncPlan, ApplyResult } from "@envsync/protocol";
import { buildConflictDetails } from "./conflict-details.js";
import type { CatalogService } from "./catalog-service.js";
import { buildLocalInventory, readManagedEnvValues } from "./inventory.js";
import type { DaemonStore } from "./store.js";
import type { PeerTransport } from "./peer-client.js";

export class SyncSessionService {
  constructor(
    private readonly store: DaemonStore,
    private readonly peerTransport: PeerTransport,
    private readonly catalog: CatalogService,
  ) {}

  async buildPlan(peerId: string, itemIds: string[]): Promise<SyncPlan> {
    const peers = this.store.listDiscovered();
    const peer = peers.find((entry) => entry.id === peerId);
    if (!peer) throw new Error("Peer não encontrado");
    if (!peer.trusted) throw new Error("Peer não confiado — pareie antes");

    const catalog = await this.catalog.getEffectiveCatalog();
    const local = await buildLocalInventory(catalog, itemIds);
    const remote = await this.peerTransport.fetchInventory(peer, itemIds);
    const plan = buildPlan(local, remote, itemIds, peerId);
    for (const action of plan.actions) {
      if (action.kind !== "conflict") continue;
      const item = catalog.items.find((entry) => entry.id === action.itemId);
      if (!item) continue;
      action.conflictDetails = await buildConflictDetails(
        item,
        peer,
        this.peerTransport,
      );
    }
    this.store.savePlan(plan);
    this.store.addActivity("plan", `Plano ${plan.id} criado para ${peer.name}`);
    return plan;
  }

  async confirm(planId: string): Promise<{ plan: SyncPlan; results: ApplyResult[] }> {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error("Plano não encontrado");
    const confirmed = markPlanConfirmed(plan);
    this.store.updatePlan(confirmed);

    const sessionBackup = backupDir(planId);
    mkdirSync(sessionBackup, { recursive: true });

    const catalog = await this.catalog.getEffectiveCatalog();
    const peer = this.store.listDiscovered().find((entry) => entry.id === plan.peerId);
    if (!peer) throw new Error("Peer offline");

    const results: ApplyResult[] = [];

    for (const action of confirmed.actions) {
      if (action.kind === "conflict" || action.kind === "skip") continue;
      if (action.kind !== "install" && action.kind !== "copy") continue;
      const direction = action.direction;
      if (direction !== "push" && direction !== "pull") continue;
      const item = catalog.items.find((entry) => entry.id === action.itemId);
      if (!item) {
        results.push({
          itemId: action.itemId,
          ok: false,
          message: "Item não encontrado no catálogo",
        });
        continue;
      }
      try {
        await this.applyItem(item, direction, sessionBackup, peer.id, true);
        action.summary =
          direction === "pull"
            ? `Instalado/aplicado localmente: ${item.label}`
            : `Enviado/aplicado no peer: ${item.label}`;
        action.kind = "skip";
        results.push({
          itemId: action.itemId,
          ok: true,
          message: action.summary,
        });
        this.store.addActivity("apply", `OK ${item.label} (${direction})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          itemId: action.itemId,
          ok: false,
          message,
        });
        this.store.addActivity("error", `Falha ${item.label}: ${message}`);
      }
    }

    this.store.updatePlan(confirmed);
    return { plan: confirmed, results };
  }

  async resolveConflict(
    planId: string,
    itemId: string,
    choice: ConflictChoice,
  ): Promise<SyncPlan> {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error("Plano não encontrado");
    if (!plan.confirmed) {
      throw new Error("Confirme o plano antes de resolver conflitos aplicáveis");
    }

    const action = plan.actions.find((entry) => entry.itemId === itemId);
    if (!action || action.kind !== "conflict") {
      throw new Error("Conflito não encontrado");
    }

    const catalog = await this.catalog.getEffectiveCatalog();
    const item = catalog.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error("Item não encontrado");

    const sessionBackup = backupDir(planId);
    mkdirSync(sessionBackup, { recursive: true });

    if (choice === "skip" || choice === "keep_local") {
      action.kind = "skip";
      action.summary = choice === "skip" ? "Pulado" : "Mantido local";
      this.store.updatePlan(plan);
      return plan;
    }

    // accept_remote → pull
    await this.applyItem(item, "pull", sessionBackup, plan.peerId, true);
    action.kind = "copy";
    action.direction = "pull";
    action.summary = "Aceito remoto";
    this.store.updatePlan(plan);
    this.store.addActivity("conflict", `Aceito remoto: ${itemId}`);
    return plan;
  }

  async resolveConflictDetail(
    planId: string,
    itemId: string,
    detailId: string,
    choice: ConflictChoice,
  ): Promise<SyncPlan> {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error("Plano não encontrado");
    if (!plan.confirmed) {
      throw new Error("Confirme o plano antes de resolver conflitos");
    }

    const action = plan.actions.find((entry) => entry.itemId === itemId);
    if (!action || action.kind !== "conflict") {
      throw new Error("Conflito não encontrado");
    }

    const detail = action.conflictDetails?.find((entry) => entry.id === detailId);
    if (!detail) throw new Error("Detalhe de conflito não encontrado");
    if (detail.resolution) throw new Error("Este conflito já foi resolvido");

    const peer = this.store.listDiscovered().find((entry) => entry.id === plan.peerId);
    if (!peer) throw new Error("Peer offline");

    const sessionBackup = backupDir(planId);
    mkdirSync(sessionBackup, { recursive: true });
    const ctx = { dataDir: this.store.root, backupRoot: sessionBackup };

    detail.resolution = choice;

    if (choice === "accept_remote" && detail.kind === "path") {
      const localPath = expandHome(detail.label);
      const temp = await this.peerTransport.pullPath(peer, detail.label);
      if (!temp) {
        throw new Error(`Remoto não tem o path: ${detail.label}`);
      }
      await filesPlugin.apply({
        direction: "pull",
        sourcePath: temp,
        targetPath: localPath,
        ctx,
        confirmed: true,
      });
      this.store.addActivity("conflict", `Aceito remoto: ${detail.label}`);
    } else if (choice === "keep_local") {
      this.store.addActivity("conflict", `Mantido local: ${detail.label}`);
    } else {
      this.store.addActivity("conflict", `Pulado: ${detail.label}`);
    }

    const pending = action.conflictDetails?.some((entry) => !entry.resolution);
    if (!pending) {
      action.kind = "skip";
      action.summary = "Todos os conflitos resolvidos";
    }

    this.store.updatePlan(plan);
    return plan;
  }

  private async applyItem(
    item: CatalogItem,
    direction: "push" | "pull",
    backupRoot: string,
    peerId: string,
    confirmed: true,
  ): Promise<void> {
    const ctx = { dataDir: this.store.root, backupRoot };
    const peer = this.store.listDiscovered().find((entry) => entry.id === peerId);
    if (!peer) throw new Error("Peer offline");

    for (const provider of item.providers) {
      if (provider.type === "package") {
        const plugin = getPlugin(
          provider.manager === "aur" ? "aur" : provider.manager,
        );
        if (direction === "push") {
          await this.peerTransport.remoteInstall(peer, provider.manager, provider.name);
          await plugin.apply({
            direction: "push",
            packageName: provider.name,
            ctx,
            confirmed,
          });
        } else {
          await plugin.apply({
            direction: "pull",
            packageName: provider.name,
            ctx,
            confirmed,
          });
        }
      } else if (provider.type === "paths") {
        for (const raw of provider.paths) {
          const localPath = expandHome(raw);
          if (direction === "push") {
            if (!existsSync(localPath)) {
              this.store.addActivity(
                "skip",
                `Path local ausente, ignorado no push: ${raw}`,
              );
              continue;
            }
            await this.peerTransport.pushPath(peer, localPath, raw);
          } else {
            const temp = await this.peerTransport.pullPath(peer, raw);
            if (!temp) {
              this.store.addActivity(
                "skip",
                `Path remoto ausente, ignorado no pull: ${raw}`,
              );
              continue;
            }
            await filesPlugin.apply({
              direction: "pull",
              sourcePath: temp,
              targetPath: localPath,
              ctx,
              confirmed,
            });
          }
        }
      } else if (provider.type === "env") {
        if (direction === "push") {
          const values = readManagedEnvValues(provider.keys);
          await this.peerTransport.pushEnv(peer, provider.keys, values);
        } else {
          const values = await this.peerTransport.pullEnv(peer, provider.keys);
          await envPlugin.apply({
            direction: "pull",
            envKeys: provider.keys,
            envValues: values,
            ctx,
            confirmed,
          });
        }
      }
    }
  }
}

export function buildPlanFromInventories(
  local: ItemInventory[],
  remote: ItemInventory[],
  selectedIds: string[],
  peerId: string,
): SyncPlan {
  return buildPlan(local, remote, selectedIds, peerId);
}
