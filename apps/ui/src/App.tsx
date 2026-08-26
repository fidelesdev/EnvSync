import { useEffect, useMemo, useState } from "react";
import { ipc } from "./ipc/client";
import { ActivityPage } from "./pages/ActivityPage";
import { CatalogPage } from "./pages/CatalogPage";
import { ConflictsPage } from "./pages/ConflictsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { PlanPage } from "./pages/PlanPage";

type Tab = "devices" | "catalog" | "plan" | "conflicts" | "activity";

type Ping = {
  ok: boolean;
  fingerprint: string;
  deviceName: string;
};

export type SyncPlanView = {
  id: string;
  peerId: string;
  confirmed: boolean;
  actions: Array<{
    itemId: string;
    kind: string;
    direction: string;
    summary: string;
    localFingerprint?: string;
    remoteFingerprint?: string;
  }>;
};

export function App() {
  const [tab, setTab] = useState<Tab>("devices");
  const [ping, setPing] = useState<Ping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");
  const [plan, setPlan] = useState<SyncPlanView | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const result = await ipc<Ping>("daemon.ping");
        if (active) {
          setPing(result);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setPing(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const tabs = useMemo(
    () =>
      [
        ["devices", "Dispositivos"],
        ["catalog", "Catálogo"],
        ["plan", "Plano"],
        ["conflicts", "Conflitos"],
        ["activity", "Atividade"],
      ] as const,
    [],
  );

  return (
    <div className="app-shell">
      <nav>
        <h1>EnvSync</h1>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {ping
            ? `${ping.deviceName} · ${ping.fingerprint.slice(0, 10)}…`
            : "Daemon offline"}
        </p>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-active={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main>
        {error ? (
          <p className="error">
            Não foi possível falar com o daemon. Rode <code>pnpm daemon</code>.{" "}
            ({error})
          </p>
        ) : null}
        {tab === "devices" ? (
          <DevicesPage
            selectedPeerId={selectedPeerId}
            onSelectPeer={setSelectedPeerId}
          />
        ) : null}
        {tab === "catalog" ? <CatalogPage /> : null}
        {tab === "plan" ? (
          <PlanPage
            selectedPeerId={selectedPeerId}
            plan={plan}
            onPlan={setPlan}
            onGoConflicts={() => setTab("conflicts")}
          />
        ) : null}
        {tab === "conflicts" ? (
          <ConflictsPage plan={plan} onPlan={setPlan} />
        ) : null}
        {tab === "activity" ? <ActivityPage /> : null}
      </main>
    </div>
  );
}
