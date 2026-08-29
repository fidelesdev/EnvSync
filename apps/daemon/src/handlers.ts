import { join } from "node:path";
import type { ConflictChoice } from "@envsync/protocol";
import { PRODUCT_NAME } from "@envsync/protocol";
import type { CatalogService } from "./catalog-service.js";
import type { DeviceIdentity } from "./identity.js";
import { DAEMON_BUILD, DAEMON_VERSION } from "./version.js";
import type { DaemonStore } from "./store.js";
import type { SyncSessionService } from "./sync-session.js";

export function createHandlers(
  store: DaemonStore,
  identity: DeviceIdentity,
  sync: SyncSessionService,
  catalog: CatalogService,
) {
  return async (method: string, params: unknown): Promise<unknown> => {
    const body = (params ?? {}) as Record<string, unknown>;

    switch (method) {
      case "daemon.ping":
        return {
          ok: true,
          version: DAEMON_VERSION,
          build: DAEMON_BUILD,
          product: PRODUCT_NAME,
          fingerprint: identity.fingerprint,
          deviceName: store.getDeviceName(),
        };
      case "daemon.shutdown": {
        store.addActivity("shutdown", "Encerramento solicitado pela UI/tray");
        setTimeout(() => {
          process.exit(0);
        }, 150);
        return { ok: true, shuttingDown: true };
      }
      case "catalog.list":
        return catalog.getEffectiveCatalog();
      case "catalog.survey": {
        const peerId = String(body.peerId ?? "");
        return catalog.survey(peerId);
      }
      case "catalog.surveyStatus": {
        const peerId = String(body.peerId ?? store.getSelectedPeerId() ?? "");
        if (!peerId) return catalog.getSurveyProgress("");
        return catalog.getSurveyProgress(peerId);
      }
      case "catalog.startSurvey": {
        const peerId = String(body.peerId ?? "");
        if (!peerId) throw new Error("peerId obrigatório");
        return catalog.startSurvey(peerId);
      }
      case "catalog.ensureSurvey": {
        const peerId = String(body.peerId ?? "");
        if (!peerId) throw new Error("peerId obrigatório");
        return catalog.ensureSurvey(peerId);
      }
      case "catalog.pickFolder":
        return catalog.pickFolder();
      case "catalog.addCustomPath": {
        const label = String(body.label ?? "");
        const path = String(body.path ?? "");
        if (!path.trim()) throw new Error("Informe o caminho da pasta");
        return catalog.addCustomPath(label, path);
      }
      case "catalog.removeItem": {
        const itemId = String(body.itemId ?? "");
        if (!itemId) throw new Error("itemId obrigatório");
        return catalog.removeItem(itemId);
      }
      case "selection.get":
        return { itemIds: store.getSelected() };
      case "selection.set": {
        const itemIds = body.itemIds as string[];
        store.setSelected(itemIds);
        return { itemIds: store.getSelected() };
      }
      case "peers.list":
        return { peers: store.listDiscovered(), trusted: store.listTrusted() };
      case "peers.getSelected":
        return { peerId: store.getSelectedPeerId() };
      case "peers.select": {
        const peerId = String(body.peerId ?? "");
        store.setSelectedPeerId(peerId);
        return { peerId };
      }
      case "peers.pair": {
        const fingerprint = String(body.fingerprint ?? "");
        const name = String(body.name ?? "peer");
        if (!fingerprint) throw new Error("fingerprint obrigatório");
        store.trustPeer({ id: fingerprint, name, fingerprint });
        store.addActivity("pair", `Peer confiado: ${name} (${fingerprint.slice(0, 12)}…)`);
        const peer = store
          .listDiscovered()
          .find((entry) => entry.fingerprint === fingerprint);
        if (peer) {
          store.setSelectedPeerId(peer.id);
        }
        return { ok: true, peerId: peer?.id ?? "" };
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
      case "sync.resolveConflictDetail": {
        const planId = String(body.planId ?? "");
        const itemId = String(body.itemId ?? "");
        const detailId = String(body.detailId ?? "");
        const choice = body.choice as ConflictChoice;
        return sync.resolveConflictDetail(planId, itemId, detailId, choice);
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
