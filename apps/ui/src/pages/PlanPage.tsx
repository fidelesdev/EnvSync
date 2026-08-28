import { useState } from "react";
import { ipc } from "../ipc/client";
import type { SyncPlanView } from "../App";

type Props = {
  selectedPeerId: string;
  plan: SyncPlanView | null;
  onPlan: (plan: SyncPlanView | null) => void;
  onOpenConfirm: () => void;
};

export function PlanPage({
  selectedPeerId,
  plan,
  onPlan,
  onOpenConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function build() {
    setBusy(true);
    setError("");
    try {
      if (!selectedPeerId) throw new Error("Selecione um dispositivo");
      const selection = await ipc<{ itemIds: string[] }>("selection.get");
      if (selection.itemIds.length === 0) {
        throw new Error("Selecione itens no catálogo");
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

  const canConfirm = Boolean(plan && !plan.confirmed);

  return (
    <div className="stack">
      <header className="page-head">
        <h2>Plano</h2>
      </header>
      <div className="row">
        <button type="button" onClick={() => void build()} disabled={busy}>
          Montar plano
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !canConfirm}
          onClick={onOpenConfirm}
        >
          Revisar e aplicar…
        </button>
      </div>
      {plan ? (
        <div className="panel stack">
          <p className="muted">
            {plan.confirmed ? "Plano confirmado" : "Aguardando confirmação"}
          </p>
          {plan.actions.map((action) => (
            <div className="item" key={action.itemId + action.kind}>
              <span
                className="badge"
                data-tone={
                  action.kind === "conflict"
                    ? "warn"
                    : action.kind === "skip"
                      ? undefined
                      : "accent"
                }
              >
                {action.kind}
              </span>
              <div>
                <strong>{action.itemId}</strong>
                <div className="muted">{action.summary}</div>
              </div>
              <span className="muted mono">{action.direction}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel muted">Nenhum plano montado.</div>
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
