import { useState } from "react";
import { ipc } from "../ipc/client";
import type { SyncPlanView } from "../App";

type Props = {
  selectedPeerId: string;
  plan: SyncPlanView | null;
  onPlan: (plan: SyncPlanView | null) => void;
  onGoConflicts: () => void;
};

export function PlanPage({
  selectedPeerId,
  plan,
  onPlan,
  onGoConflicts,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function build() {
    setBusy(true);
    setError("");
    try {
      if (!selectedPeerId) throw new Error("Selecione um peer em Dispositivos");
      const selection = await ipc<{ itemIds: string[] }>("selection.get");
      if (selection.itemIds.length === 0) {
        throw new Error("Selecione ao menos um item no Catálogo");
      }
      const next = await ipc<SyncPlanView>("sync.buildPlan", {
        peerId: selectedPeerId,
        itemIds: selection.itemIds,
      });
      onPlan(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const next = await ipc<SyncPlanView>("sync.confirm", { planId: plan.id });
      onPlan(next);
      const hasConflicts = next.actions.some((action) => action.kind === "conflict");
      if (hasConflicts) onGoConflicts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h2>Plano de sincronização</h2>
        <p className="muted">
          Nenhuma alteração é aplicada sem o botão <strong>Confirmar</strong>.
        </p>
      </div>
      <div className="row">
        <button type="button" onClick={() => void build()} disabled={busy}>
          Montar plano
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !plan || plan.confirmed}
          onClick={() => void confirm()}
        >
          Confirmar
        </button>
      </div>
      {plan ? (
        <div className="panel stack">
          <p className="muted">
            Plano {plan.id.slice(0, 8)}… ·{" "}
            {plan.confirmed ? "confirmado" : "aguardando confirmação"}
          </p>
          {plan.actions.map((action) => (
            <div className="item" key={action.itemId + action.kind}>
              <span className="badge">{action.kind}</span>
              <div>
                <strong>{action.itemId}</strong>
                <div className="muted">{action.summary}</div>
              </div>
              <span className="muted">{action.direction}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel muted">Nenhum plano montado ainda.</div>
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
