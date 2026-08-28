import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc } from "../ipc/client";
import type { CatalogSurvey } from "@envsync/protocol";

type Props = {
  selectedPeerId: string;
  peerName?: string;
};

export function CatalogPage({ selectedPeerId, peerName }: Props) {
  const [survey, setSurvey] = useState<CatalogSurvey | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedPeerId) {
      setSurvey(null);
      return;
    }
    const [nextSurvey, selection] = await Promise.all([
      ipc<CatalogSurvey>("catalog.survey", { peerId: selectedPeerId }),
      ipc<{ itemIds: string[] }>("selection.get"),
    ]);
    setSurvey(nextSurvey);
    setSelected(new Set(selection.itemIds));
    setError("");
  }, [selectedPeerId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    if (!selectedPeerId) return;
    const id = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(id);
  }, [load, selectedPeerId]);

  const groupLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of survey?.groups ?? []) {
      map.set(group.id, group.label);
    }
    return map;
  }, [survey]);

  async function persist(next: Set<string>) {
    setSelected(next);
    await ipc("selection.set", { itemIds: [...next] });
    setStatus(`${next.size} itens selecionados`);
  }

  function toggleItem(itemId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    void persist(next);
  }

  async function addCustomFolder() {
    setBusy(true);
    setError("");
    try {
      await ipc("catalog.addCustomPath", {
        label: customLabel,
        path: customPath,
      });
      setCustomLabel("");
      setCustomPath("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    setBusy(true);
    setError("");
    try {
      await ipc("catalog.removeItem", { itemId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!selectedPeerId) {
    return (
      <div className="stack">
        <header className="page-head">
          <h2>Catálogo</h2>
        </header>
        <div className="panel muted">Selecione um dispositivo em Dispositivos.</div>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h2>Catálogo</h2>
        {survey ? (
          <p className="muted">
            Comparando <strong>{survey.deviceName}</strong> com{" "}
            <strong>{survey.peerDeviceName || peerName}</strong>
          </p>
        ) : null}
      </header>

      <div className="panel stack catalog-custom">
        <strong>Adicionar pasta</strong>
        <div className="row">
          <input
            type="text"
            placeholder="Nome (opcional)"
            value={customLabel}
            onChange={(event) => setCustomLabel(event.target.value)}
            aria-label="Nome da pasta"
          />
          <input
            type="text"
            placeholder="~/caminho/da/pasta"
            value={customPath}
            onChange={(event) => setCustomPath(event.target.value)}
            aria-label="Caminho da pasta"
            className="grow"
          />
          <button
            type="button"
            className="primary"
            disabled={busy || !customPath.trim()}
            onClick={() => void addCustomFolder()}
          >
            Adicionar
          </button>
        </div>
      </div>

      {!survey ? (
        <div className="panel muted">Carregando catálogo…</div>
      ) : (
        survey.sections.map((section) => {
          if (section.items.length === 0) return null;
          return (
            <section className="catalog-section" key={section.id}>
              <h3 className="catalog-section-title">{section.title}</h3>
              <div className="panel">
                {section.items.map((item) => (
                  <label className="item catalog-item" key={item.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={(event) =>
                        toggleItem(item.id, event.target.checked)
                      }
                    />
                    <div>
                      <strong>{item.label}</strong>
                      <div className="muted">
                        {groupLabels.get(item.groupId) ?? item.groupId}
                        {item.inSync ? " · igual" : ""}
                        {item.detail ? ` · ${item.detail}` : ""}
                      </div>
                    </div>
                    <div className="row catalog-item-actions">
                      <span className="badge" data-tone={item.source === "custom" ? "accent" : undefined}>
                        {item.source}
                      </span>
                      {item.source === "custom" ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            void removeItem(item.id);
                          }}
                        >
                          Remover
                        </button>
                      ) : item.source === "discovered" ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            void removeItem(item.id);
                          }}
                        >
                          Ocultar
                        </button>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          );
        })
      )}

      {status ? <p className="muted">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
