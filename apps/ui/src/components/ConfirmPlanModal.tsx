import type { SyncPlanView } from "../App";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  plan: SyncPlanView | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function actionLabel(action: SyncPlanView["actions"][number]): string {
  if (action.kind === "conflict") return "Conflito";
  if (action.kind === "skip") return "Ignorar";
  if (action.kind === "install") {
    if (action.itemId.startsWith("auto:pacman:") || action.itemId.startsWith("auto:flatpak:")) {
      return action.direction === "pull"
        ? "Instalar aqui (pacman/flatpak local)"
        : "Instalar no peer via rede";
    }
    return action.direction === "pull" ? "Copiar para cá" : "Enviar para peer";
  }
  return "Copiar";
}

function actionNote(action: SyncPlanView["actions"][number]): string | null {
  if (action.kind !== "install") return null;
  if (action.itemId.startsWith("auto:pacman:") && action.direction === "pull") {
    return "Pacotes não são copiados entre PCs — instala dos repositórios desta máquina.";
  }
  if (action.direction === "pull" && action.itemId.startsWith("custom:")) {
    return "Arquivos serão transferidos do outro dispositivo via TLS.";
  }
  return null;
}

export function ConfirmPlanModal({
  open,
  plan,
  busy,
  onClose,
  onConfirm,
}: Props) {
  if (!plan) return null;

  const conflicts = plan.actions.filter((action) => action.kind === "conflict");
  const executable = plan.actions.filter(
    (action) => action.kind === "install" || action.kind === "copy",
  );

  return (
    <Modal open={open} title="Confirmar sincronização" onClose={onClose}>
      <div className="stack">
        {executable.length > 0 ? (
          <section className="modal-section">
            <h4>Ações imediatas</h4>
            <ul className="modal-list">
              {executable.map((action) => {
                const note = actionNote(action);
                return (
                  <li key={`${action.itemId}-${action.kind}`}>
                    <strong>{action.itemId}</strong>
                    <span className="badge" data-tone="accent">
                      {actionLabel(action)}
                    </span>
                    <span className="muted">{action.summary}</span>
                    {note ? <span className="muted">{note}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className="muted">Nenhuma ação automática — só conflitos para resolver.</p>
        )}

        {conflicts.length > 0 ? (
          <section className="modal-section">
            <h4>Conflitos (resolver depois)</h4>
            <ul className="modal-list">
              {conflicts.map((action) => (
                <li key={action.itemId}>
                  <strong>{action.itemId}</strong>
                  <span className="badge" data-tone="warn">
                    conflito
                  </span>
                  {(action.conflictDetails ?? []).map((detail) => (
                    <div className="conflict-detail" key={detail.id}>
                      <code>{detail.label}</code>
                      <span className="muted">
                        local: {detail.localSummary} · remoto: {detail.remoteSummary}
                      </span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="row modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Aplicando…" : "Confirmar e aplicar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
