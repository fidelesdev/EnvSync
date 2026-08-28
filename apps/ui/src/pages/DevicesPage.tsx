import { useCallback, useEffect, useState } from "react";
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
  selectedPeerId: string;
  onSelectPeer: (id: string) => void;
};

export function DevicesPage({ selectedPeerId, onSelectPeer }: Props) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [message, setMessage] = useState<string>("");

  const refresh = useCallback(async () => {
    const result = await ipc<{ peers: Peer[] }>("peers.list");
    setPeers(result.peers);
  }, []);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="stack">
      <header className="page-head">
        <h2>Dispositivos</h2>
      </header>
      <div className="device-grid">
        {peers.length === 0 ? (
          <p className="muted panel">Nenhum dispositivo na rede.</p>
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
                  <span
                    className="badge"
                    data-tone={peer.online ? "ok" : undefined}
                  >
                    {peer.online ? "online" : "offline"}
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
                        }).then(refresh)
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
                        }).then(refresh)
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
      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}
