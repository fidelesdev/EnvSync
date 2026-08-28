import { useState } from "react";
import { ipc } from "../ipc/client";
import type { SyncPlanView } from "../App";

type Props = {
  plan: SyncPlanView | null;
  onPlan: (plan: SyncPlanView) => void;
};

export function ConflictsPage({ plan, onPlan }: Props) {
  const [error, setError] = useState("");
  const conflicts =
    plan?.actions.filter((action) => action.kind === "conflict") ?? [];

  async function resolveDetail(
    itemId: string,
    detailId: string,
    choice: "keep_local" | "accept_remote" | "skip",
  ) {
    if (!plan) return;
    setError("");
    try {
      const next = await ipc<SyncPlanView>("sync.resolveConflictDetail", {
        planId: plan.id,
        itemId,
        detailId,
        choice,
      });
      onPlan(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h2>Conflitos</h2>
      </header>
      {!plan ? (
        <div className="panel muted">Monte um plano primeiro.</div>
      ) : !plan.confirmed ? (
        <div className="panel muted">
          Confirme o plano para resolver conflitos item a item.
        </div>
      ) : conflicts.length === 0 ? (
        <div className="panel muted">Nenhum conflito pendente.</div>
      ) : (
        conflicts.map((action) => (
          <div className="panel stack" key={action.itemId}>
            <strong>{action.itemId}</strong>
            {(action.conflictDetails ?? []).map((detail) => (
              <div className="conflict-card" key={detail.id} data-resolved={Boolean(detail.resolution)}>
                <div className="conflict-card-head">
                  <code>{detail.label}</code>
                  <span className="badge" data-tone={detail.resolution ? "ok" : "warn"}>
                    {detail.resolution ?? "pendente"}
                  </span>
                </div>
                <p className="muted">
                  Local: {detail.localSummary} · Remoto: {detail.remoteSummary}
                </p>
                {detail.diff ? (
                  <pre className="diff-preview">{detail.diff}</pre>
                ) : null}
                {!detail.resolution ? (
                  <div className="row">
                    <button
                      type="button"
                      onClick={() => void resolveDetail(action.itemId, detail.id, "keep_local")}
                    >
                      Manter local
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        void resolveDetail(action.itemId, detail.id, "accept_remote")
                      }
                    >
                      Aceitar remoto
                    </button>
                    <button
                      type="button"
                      onClick={() => void resolveDetail(action.itemId, detail.id, "skip")}
                    >
                      Pular
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
