import type { CatalogSurveyItem } from "@envsync/protocol";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  items: CatalogSurveyItem[];
  onClose: () => void;
};

export function IdentifiedItemsModal({ open, items, onClose }: Props) {
  return (
    <Modal open={open} title="Itens identificados" onClose={onClose}>
      {items.length === 0 ? (
        <p className="muted">Nenhum item identificado ainda.</p>
      ) : (
        <ul className="modal-list identified-list">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <span className="muted mono">{item.id}</span>
              <span className="badge" data-tone={item.inSync ? "ok" : undefined}>
                {item.localPresent && item.remotePresent
                  ? item.inSync
                    ? "igual"
                    : "diferente"
                  : item.remotePresent
                    ? "só remoto"
                    : "só local"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
