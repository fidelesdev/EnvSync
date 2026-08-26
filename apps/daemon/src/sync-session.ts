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
import type { ConflictChoice, SyncPlan } from "@envsync/protocol";
import { buildLocalInventory, readManagedEnvValues } from "./inventory.js";
import type { DaemonStore } from "./store.js";
import type { PeerTransport } from "./peer-client.js";

export class SyncSessionService {
  constructor(
    private readonly store: DaemonStore,
    private readonly peerTransport: PeerTransport,
  ) {}

  async buildPlan(peerId: string, itemIds: string[]): Promise<SyncPlan> {
    const peers = this.store.listDiscovered();
    const peer = peers.find((entry) => entry.id === peerId);
    if (!peer) throw new Error("Peer não encontrado");
    if (!peer.trusted) throw new Error("Peer não confiado — pareie antes");

    const catalog = this.store.getCatalog();
    const local = await buildLocalInventory(catalog, itemIds);
    const remote = await this.peerTransport.fetchInventory(peer, itemIds);
    const plan = buildPlan(local, remote, itemIds, peerId);
    this.store.savePlan(plan);
    this.store.addActivity("plan", `Plano ${plan.id} criado para ${peer.name}`);
    return plan;
  }

  async confirm(planId: string): Promise<SyncPlan> {
    const plan = this.store.getPlan(planId);
    if (!plan) throw new Error("Plano não encontrado");
    const confirmed = markPlanConfirmed(plan);
    this.store.updatePlan(confirmed);

    const sessionBackup = backupDir(planId);
    mkdirSync(sessionBackup, { recursive: true });

    const catalog = this.store.getCatalog();
    const peer = this.store.listDiscovered().find((entry) => entry.id === plan.peerId);
    if (!peer) throw new Error("Peer offline");

    for (const action of confirmed.actions) {
      if (action.kind === "conflict" || action.kind === "skip") continue;
      if (action.kind !== "install" && action.kind !== "copy") continue;
      const direction = action.direction;
      if (direction !== "push" && direction !== "pull") continue;
      const item = catalog.items.find((entry) => entry.id === action.itemId);
      if (!item) continue;
      try {
        await this.applyItem(item, direction, sessionBackup, peer.id, true);
        this.store.addActivity("apply", `OK ${item.id} (${direction})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.addActivity("error", `Falha ${item.id}: ${message}`);
      }
    }

    return confirmed;
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

    const catalog = this.store.getCatalog();
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
