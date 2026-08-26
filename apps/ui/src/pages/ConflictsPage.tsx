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

  async function resolve(
    itemId: string,
    choice: "keep_local" | "accept_remote" | "skip",
  ) {
    if (!plan) return;
    setError("");
    try {
      const next = await ipc<SyncPlanView>("sync.resolveConflict", {
        planId: plan.id,
        itemId,
        choice,
      });
      onPlan(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="stack">
      <div>
        <h2>Conflitos</h2>
        <p className="muted">
          Confirme o plano antes. Depois escolha manter local, aceitar remoto ou
          pular.
        </p>
      </div>
      {!plan ? (
        <div className="panel muted">Monte e confirme um plano primeiro.</div>
      ) : conflicts.length === 0 ? (
        <div className="panel muted">Nenhum conflito pendente.</div>
      ) : (
        conflicts.map((action) => (
          <div className="panel stack" key={action.itemId}>
            <strong>{action.itemId}</strong>
            <p className="muted">{action.summary}</p>
            <p className="muted">
              local: {action.localFingerprint?.slice(0, 12) ?? "—"} · remoto:{" "}
              {action.remoteFingerprint?.slice(0, 12) ?? "—"}
            </p>
            <div className="row">
              <button
                type="button"
                onClick={() => void resolve(action.itemId, "keep_local")}
              >
                Manter local
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void resolve(action.itemId, "accept_remote")}
              >
                Aceitar remoto
              </button>
              <button
                type="button"
                onClick={() => void resolve(action.itemId, "skip")}
              >
                Pular
              </button>
            </div>
          </div>
        ))
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
