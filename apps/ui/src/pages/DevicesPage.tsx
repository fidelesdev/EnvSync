import { ipc } from "../ipc/client";

type Peer = {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  trusted: boolean;
  fingerprint: string;
};

type Props = {
  peers: Peer[];
  selectedPeerId: string;
  onSelectPeer: (id: string) => void;
};

export function DevicesPage({ peers, selectedPeerId, onSelectPeer }: Props) {
  return (
    <div className="stack">
      <header className="page-head">
        <h2>Dispositivos</h2>
      </header>
      <div className="device-grid">
        {peers.length === 0 ? (
          <p className="muted panel">
            Nenhum EnvSync encontrado na rede. Abra o app no outro dispositivo.
          </p>
        ) : (
          peers.map((peer) => {
            const selected = selectedPeerId === peer.id;
            return (
              <button
                key={peer.id}
                type="button"
                className="device-card"
                data-selected={selected}
                onClick={() => onSelectPeer(peer.id)}
                aria-pressed={selected}
              >
                <div className="device-card-top">
                  <span className="device-select-mark" aria-hidden />
                  <strong>{peer.name}</strong>
                </div>
                <div className="muted mono device-meta">
                  {peer.host}:{peer.port}
                </div>
                <div className="row">
                  <span className="badge" data-tone="ok">
                    EnvSync ativo
                  </span>
                  <span
                    className="badge"
                    data-tone={peer.trusted ? "accent" : "warn"}
                  >
                    {peer.trusted ? "pareado" : "não pareado"}
                  </span>
                </div>
                <div
                  className="row device-actions"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {peer.trusted ? (
                    <button
                      type="button"
                      onClick={() =>
                        void ipc("peers.unpair", {
                          fingerprint: peer.fingerprint,
                        })
                      }
                    >
                      Desparear
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        void ipc("peers.pair", {
                          fingerprint: peer.fingerprint,
                          name: peer.name,
                        })
                      }
                    >
                      Parear
                    </button>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
