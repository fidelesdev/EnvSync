import { useCallback, useEffect, useState } from "react";
import { ipc } from "../ipc/client";
import { Modal } from "./Modal";
import type { RemoteDirListing } from "@envsync/protocol";

type Props = {
  open: boolean;
  peerId: string;
  peerName: string;
  onClose: () => void;
  onSelect: (path: string) => void;
};

export function RemoteFolderModal({
  open,
  peerId,
  peerName,
  onClose,
  onSelect,
}: Props) {
  const [listing, setListing] = useState<RemoteDirListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadPath = useCallback(
    async (path: string) => {
      setBusy(true);
      setError("");
      try {
        const result = await ipc<RemoteDirListing>("catalog.listRemoteDir", {
          peerId,
          path,
        });
        setListing(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setListing(null);
      } finally {
        setBusy(false);
      }
    },
    [peerId],
  );

  useEffect(() => {
    if (!open) {
      setListing(null);
      setError("");
      return;
    }
    void loadPath("~");
  }, [open, loadPath]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={`Pastas em ${peerName}`}
      onClose={onClose}
    >
      <div className="stack remote-folder-modal">
        <p className="muted">
          Navegue no dispositivo selecionado. O caminho será usado na sincronização.
        </p>

        {listing ? (
          <div className="remote-folder-current">
            <code>{listing.path}</code>
            <div className="row remote-folder-actions">
              {listing.parent ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadPath(listing.parent ?? "~")}
                >
                  ↑ Pasta acima
                </button>
              ) : null}
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  onSelect(listing.path);
                  onClose();
                }}
              >
                Selecionar esta pasta
              </button>
            </div>
          </div>
        ) : null}

        {busy ? <p className="muted">Carregando pastas…</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {listing && listing.entries.length > 0 ? (
          <ul className="remote-folder-list">
            {listing.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="remote-folder-entry"
                  disabled={busy}
                  onClick={() => void loadPath(entry.path)}
                >
                  <span aria-hidden>📁</span>
                  <span>{entry.name}</span>
                  <span className="muted mono">{entry.path}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : listing && !busy ? (
          <p className="muted">Nenhuma subpasta visível aqui.</p>
        ) : null}
      </div>
    </Modal>
  );
}
