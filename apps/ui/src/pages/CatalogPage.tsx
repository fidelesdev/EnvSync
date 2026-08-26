import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc } from "../ipc/client";

type Catalog = {
  groups: Array<{ id: string; label: string }>;
  items: Array<{ id: string; label: string; groupId: string }>;
};

export function CatalogPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const cat = await ipc<Catalog>("catalog.list");
    const sel = await ipc<{ itemIds: string[] }>("selection.get");
    setCatalog(cat);
    setSelected(new Set(sel.itemIds));
  }, []);

  useEffect(() => {
    void load().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }, [load]);

  const byGroup = useMemo(() => {
    if (!catalog) return [];
    return catalog.groups.map((group) => ({
      group,
      items: catalog.items.filter((item) => item.groupId === group.id),
    }));
  }, [catalog]);

  async function persist(next: Set<string>) {
    setSelected(next);
    await ipc("selection.set", { itemIds: [...next] });
    setStatus(`Seleção salva (${next.size} itens)`);
  }

  function toggleItem(itemId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    void persist(next);
  }

  function toggleGroup(groupId: string, checked: boolean) {
    if (!catalog) return;
    const next = new Set(selected);
    for (const item of catalog.items) {
      if (item.groupId !== groupId) continue;
      if (checked) next.add(item.id);
      else next.delete(item.id);
    }
    void persist(next);
  }

  return (
    <div className="stack">
      <div>
        <h2>Catálogo</h2>
        <p className="muted">
          Selecione grupos inteiros ou itens individuais para a próxima sync.
        </p>
      </div>
      <div className="panel">
        {byGroup.map(({ group, items }) => {
          const allSelected =
            items.length > 0 && items.every((item) => selected.has(item.id));
          return (
            <div key={group.id}>
              <div className="group-title row">
                <label className="row">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) =>
                      toggleGroup(group.id, event.target.checked)
                    }
                  />
                  <span>{group.label}</span>
                </label>
              </div>
              {items.map((item) => (
                <label className="item" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={(event) =>
                      toggleItem(item.id, event.target.checked)
                    }
                  />
                  <span>{item.label}</span>
                  <span className="muted">{item.id}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {status ? <p className="muted">{status}</p> : null}
    </div>
  );
}
