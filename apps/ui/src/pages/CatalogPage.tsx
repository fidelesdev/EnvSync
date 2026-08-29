import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc } from "../ipc/client";
import { pickFolder } from "../lib/pick-folder";
import { IdentifiedItemsModal } from "../components/IdentifiedItemsModal";
import type { CatalogSurveyProgress } from "@envsync/protocol";

type Props = {
  selectedPeerId: string;
  surveyProgress: CatalogSurveyProgress | null;
  onStartSurvey: (peerId: string) => void;
};

export function CatalogPage({
  selectedPeerId,
  surveyProgress,
  onStartSurvey,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [identifiedOpen, setIdentifiedOpen] = useState(false);

  const loadSelection = useCallback(async () => {
    const selection = await ipc<{ itemIds: string[] }>("selection.get");
    setSelected(new Set(selection.itemIds));
  }, []);

  useEffect(() => {
    void loadSelection().catch(() => undefined);
  }, [loadSelection]);

  const progress =
    surveyProgress?.peerId === selectedPeerId ? surveyProgress : null;
  const survey = progress?.survey ?? null;
  const isRunning = progress?.status === "running";
  const hasError = progress?.status === "error";
  const hasSurvey = progress?.status === "done" && Boolean(survey);
  const showProgress = isRunning || hasError || hasSurvey;

  const groupLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of survey?.groups ?? []) {
      map.set(group.id, group.label);
    }
    return map;
  }, [survey]);

  const sections = progress?.sections ?? survey?.sections ?? [];

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

  async function browseFolder() {
    setError("");
    try {
      const path = await pickFolder();
      if (!path) return;
      setCustomPath(path);
      if (!customLabel.trim()) {
        const name = path.split("/").filter(Boolean).pop() ?? path;
        setCustomLabel(name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
      setStatus("Pasta adicionada. Busque o catálogo novamente para incluí-la.");
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
      setStatus("Item removido. Busque o catálogo novamente se necessário.");
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

  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : isRunning
        ? 8
        : 0;

  return (
    <div className="stack">
      <header className="page-head catalog-head">
        <div>
          <h2>Catálogo</h2>
          {survey ? (
            <p className="muted">
              Comparando <strong>{survey.deviceName}</strong> com{" "}
              <strong>{survey.peerDeviceName}</strong>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="primary"
          disabled={isRunning}
          onClick={() => onStartSurvey(selectedPeerId)}
        >
          {isRunning ? "Buscando…" : hasSurvey ? "Buscar novamente" : "Buscar catálogo"}
        </button>
      </header>

      {!showProgress ? (
        <div className="panel muted">
          Nenhuma busca feita. Clique em <strong>Buscar catálogo</strong> para comparar
          os dois dispositivos.
        </div>
      ) : (
        <div
          className="panel catalog-progress"
          data-running={isRunning}
          data-error={hasError}
        >
          <div className="catalog-progress-head">
            <div>
              <strong>
                {hasError ? "Falha na identificação" : progress?.phase ?? "Aguardando"}
              </strong>
              {hasError && progress?.error ? (
                <p className="error catalog-progress-error">{progress.error}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="catalog-identified-btn"
              onClick={() => setIdentifiedOpen(true)}
              disabled={!progress || progress.identifiedCount === 0}
            >
              {progress?.identifiedCount ?? 0} identificados
            </button>
          </div>
          <div className="catalog-progress-track" aria-hidden>
            <div
              className="catalog-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {hasError ? (
            <p className="muted mono catalog-log-hint">
              Log detalhado: ~/.local/share/envsync/catalog-survey.log
            </p>
          ) : null}
        </div>
      )}

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
            placeholder="Nenhuma pasta selecionada"
            value={customPath}
            readOnly
            aria-label="Caminho da pasta"
            className="grow"
          />
          <button type="button" onClick={() => void browseFolder()} disabled={busy}>
            Escolher pasta…
          </button>
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

      {isRunning && sections.every((section) => section.items.length === 0) ? (
        <div className="panel muted">Identificando itens…</div>
      ) : null}

      {hasSurvey
        ? sections.map((section) => {
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
                        <span
                          className="badge"
                          data-tone={item.source === "custom" ? "accent" : undefined}
                        >
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
        : null}

      {status ? <p className="muted">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <IdentifiedItemsModal
        open={identifiedOpen}
        items={progress?.identified ?? []}
        onClose={() => setIdentifiedOpen(false)}
      />
    </div>
  );
}
