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
        <h2>Dispositivos na LAN</h2>
        <p>
          Pareie pelo fingerprint antes de sincronizar. Só peers confiados
          entram no plano.
        </p>
      </header>
      <div className="panel stack">
        {peers.length === 0 ? (
          <p className="muted">Nenhum peer anunciado ainda (mDNS).</p>
        ) : (
          peers.map((peer) => (
            <div className="item" key={peer.id}>
              <input
                type="radio"
                name="peer"
                checked={selectedPeerId === peer.id}
                onChange={() => onSelectPeer(peer.id)}
                aria-label={`Selecionar ${peer.name}`}
              />
              <div>
                <strong>{peer.name}</strong>
                <div className="muted mono">
                  {peer.host}:{peer.port} · {peer.fingerprint.slice(0, 16)}…
                </div>
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
                  {peer.trusted ? "confiável" : "não pareado"}
                </span>
                {peer.trusted ? (
                  <button
                    type="button"
                    onClick={() =>
                      void ipc("peers.unpair", {
                        fingerprint: peer.fingerprint,
                      }).then(refresh)
                    }
                  >
                    Remover
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
            </div>
          ))
        )}
      </div>
      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}
