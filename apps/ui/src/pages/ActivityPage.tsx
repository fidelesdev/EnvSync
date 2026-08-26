import { useEffect, useState } from "react";
import { ipc } from "../ipc/client";

type Entry = {
  id: string;
  at: string;
  kind: string;
  message: string;
};

export function ActivityPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const result = await ipc<{ entries: Entry[] }>("activity.list");
        setEntries(result.entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="stack">
      <div>
        <h2>Atividade</h2>
        <p className="muted">
          Histórico local. Backups ficam em{" "}
          <code>~/.local/share/envsync/backups/</code>.
        </p>
      </div>
      <div className="panel">
        {entries.length === 0 ? (
          <p className="muted">Sem eventos ainda.</p>
        ) : (
          entries.map((entry) => (
            <div className="item" key={entry.id}>
              <span className="badge">{entry.kind}</span>
              <div>
                <div>{entry.message}</div>
                <div className="muted">{new Date(entry.at).toLocaleString()}</div>
              </div>
              <span />
            </div>
          ))
        )}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
