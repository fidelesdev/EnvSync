import { randomUUID } from "node:crypto";
import type { PlanAction, SyncPlan } from "@envsync/protocol";
import type { ItemInventory } from "./inventory.js";

function indexById(
  rows: ItemInventory[],
): Map<string, ItemInventory> {
  const map = new Map<string, ItemInventory>();
  for (const row of rows) map.set(row.itemId, row);
  return map;
}

function absent(itemId: string): ItemInventory {
  return { itemId, fingerprint: "", presence: "absent", detail: "" };
}

export function buildPlan(
  localRows: ItemInventory[],
  remoteRows: ItemInventory[],
  selectedIds: string[],
  peerId: string,
): SyncPlan {
  const localMap = indexById(localRows);
  const remoteMap = indexById(remoteRows);
  const actions: PlanAction[] = [];

  for (const itemId of selectedIds) {
    const local = localMap.get(itemId) ?? absent(itemId);
    const remote = remoteMap.get(itemId) ?? absent(itemId);

    if (local.presence === "absent" && remote.presence === "absent") {
      actions.push({
        itemId,
        kind: "skip",
        direction: "none",
        summary: "Ausente nos dois lados",
      });
      continue;
    }

    if (local.presence === "present" && remote.presence === "absent") {
      actions.push({
        itemId,
        kind: "install",
        direction: "push",
        summary: `Enviar/instalar no peer (${local.detail || local.fingerprint})`,
        localFingerprint: local.fingerprint,
      });
      continue;
    }

    if (local.presence === "absent" && remote.presence === "present") {
      actions.push({
        itemId,
        kind: "install",
        direction: "pull",
        summary: `Puxar/instalar localmente (${remote.detail || remote.fingerprint})`,
        remoteFingerprint: remote.fingerprint,
      });
      continue;
    }

    if (local.fingerprint === remote.fingerprint) {
      actions.push({
        itemId,
        kind: "skip",
        direction: "none",
        summary: "Já iguais",
        localFingerprint: local.fingerprint,
        remoteFingerprint: remote.fingerprint,
      });
      continue;
    }

    actions.push({
      itemId,
      kind: "conflict",
      direction: "none",
      summary: "Diferença — resolver na UI",
      localFingerprint: local.fingerprint,
      remoteFingerprint: remote.fingerprint,
    });
  }

  return {
    id: randomUUID(),
    peerId,
    actions,
    createdAt: new Date().toISOString(),
    confirmed: false,
  };
}

export function assertPlanConfirmable(plan: SyncPlan): void {
  if (plan.confirmed) {
    throw new Error("Plano já confirmado");
  }
  const executable = plan.actions.filter(
    (action) => action.kind === "install" || action.kind === "copy",
  );
  if (executable.length === 0) {
    const hasConflict = plan.actions.some((action) => action.kind === "conflict");
    if (!hasConflict) {
      throw new Error("Nenhuma ação executável no plano");
    }
  }
}

export function markPlanConfirmed(plan: SyncPlan): SyncPlan {
  assertPlanConfirmable(plan);
  return { ...plan, confirmed: true };
}
