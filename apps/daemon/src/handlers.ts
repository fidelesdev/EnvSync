import { join } from "node:path";
import type { ConflictChoice } from "@envsync/protocol";
import { PRODUCT_NAME } from "@envsync/protocol";
import type { DeviceIdentity } from "./identity.js";
import type { DaemonStore } from "./store.js";
import type { SyncSessionService } from "./sync-session.js";

export function createHandlers(
  store: DaemonStore,
  identity: DeviceIdentity,
  sync: SyncSessionService,
) {
  return async (method: string, params: unknown): Promise<unknown> => {
    const body = (params ?? {}) as Record<string, unknown>;

    switch (method) {
      case "daemon.ping":
        return {
          ok: true,
          version: "0.1.0",
          product: PRODUCT_NAME,
          fingerprint: identity.fingerprint,
          deviceName: store.getDeviceName(),
        };
      case "catalog.list":
        return store.getCatalog();
      case "selection.get":
        return { itemIds: store.getSelected() };
      case "selection.set": {
        const itemIds = body.itemIds as string[];
        store.setSelected(itemIds);
        return { itemIds: store.getSelected() };
      }
      case "peers.list":
        return { peers: store.listDiscovered(), trusted: store.listTrusted() };
      case "peers.pair": {
        const fingerprint = String(body.fingerprint ?? "");
        const name = String(body.name ?? "peer");
        if (!fingerprint) throw new Error("fingerprint obrigatório");
        store.trustPeer({ id: fingerprint, name, fingerprint });
        store.addActivity("pair", `Peer confiado: ${name} (${fingerprint.slice(0, 12)}…)`);
        return { ok: true };
      }
      case "peers.unpair": {
        const fingerprint = String(body.fingerprint ?? "");
        store.untrustPeer(fingerprint);
        store.addActivity("unpair", `Peer removido: ${fingerprint.slice(0, 12)}…`);
        return { ok: true };
      }
      case "sync.buildPlan": {
        const peerId = String(body.peerId ?? "");
        const itemIds = (body.itemIds as string[]) ?? store.getSelected();
        return sync.buildPlan(peerId, itemIds);
      }
      case "sync.confirm": {
        const planId = String(body.planId ?? "");
        return sync.confirm(planId);
      }
      case "sync.resolveConflict": {
        const planId = String(body.planId ?? "");
        const itemId = String(body.itemId ?? "");
        const choice = body.choice as ConflictChoice;
        return sync.resolveConflict(planId, itemId, choice);
      }
      case "sync.status": {
        const planId = String(body.planId ?? "");
        return store.getPlan(planId) ?? null;
      }
      case "activity.list":
        return { entries: store.listActivity() };
      case "backup.restore": {
        // MVP: expose backup path for manual restore
        const sessionId = String(body.sessionId ?? "");
        return { path: join(store.root, "backups", sessionId) };
      }
      default:
        throw new Error(`Método desconhecido: ${method}`);
    }
  };
}
