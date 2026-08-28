import { useEffect, useMemo, useState } from "react";
import { ipc } from "./ipc/client";
import { ConfirmPlanModal } from "./components/ConfirmPlanModal";
import { ActivityPage } from "./pages/ActivityPage";
import { CatalogPage } from "./pages/CatalogPage";
import { ConflictsPage } from "./pages/ConflictsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { PlanPage } from "./pages/PlanPage";
import type { ConflictDetail } from "@envsync/protocol";

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
    conflictDetails?: ConflictDetail[];
  }>;
};

const TAB_META: Array<{ id: Tab; label: string }> = [
  { id: "devices", label: "Dispositivos" },
  { id: "catalog", label: "Catálogo" },
  { id: "plan", label: "Plano" },
  { id: "conflicts", label: "Conflitos" },
  { id: "activity", label: "Atividade" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("devices");
  const [ping, setPing] = useState<Ping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");
  const [plan, setPlan] = useState<SyncPlanView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  const conflictCount = useMemo(
    () => plan?.actions.filter((action) => action.kind === "conflict").length ?? 0,
    [plan],
  );

  async function confirmPlan() {
    if (!plan) return;
    setConfirmBusy(true);
    try {
      const next = await ipc<SyncPlanView>("sync.confirm", { planId: plan.id });
      setPlan(next);
      setConfirmOpen(false);
      if (next.actions.some((action) => action.kind === "conflict")) {
        setTab("conflicts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-orb" aria-hidden />
            <h1>EnvSync</h1>
          </div>
          <div className="status-pill" data-online={Boolean(ping)}>
            <span className="status-dot" aria-hidden />
            <span>{ping ? "online" : "offline"}</span>
          </div>
          {ping ? (
            <p className="brand-sub mono">{ping.deviceName}</p>
          ) : null}
        </div>

        <div className="nav-list">
          {TAB_META.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-active={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              <span className="nav-icon" aria-hidden data-tab={entry.id} />
              <span>
                {entry.label}
                {entry.id === "conflicts" && conflictCount > 0
                  ? ` (${conflictCount})`
                  : ""}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="content" key={tab}>
        {error ? (
          <p className="error">
            Não foi possível falar com o daemon. Rode <code>pnpm daemon</code>.
            <br />
            <span className="mono">{error}</span>
          </p>
        ) : null}
        {tab === "devices" ? (
          <DevicesPage
            selectedPeerId={selectedPeerId}
            onSelectPeer={setSelectedPeerId}
          />
        ) : null}
        {tab === "catalog" ? (
          <CatalogPage selectedPeerId={selectedPeerId} />
        ) : null}
        {tab === "plan" ? (
          <PlanPage
            selectedPeerId={selectedPeerId}
            plan={plan}
            onPlan={setPlan}
            onOpenConfirm={() => setConfirmOpen(true)}
          />
        ) : null}
        {tab === "conflicts" ? (
          <ConflictsPage plan={plan} onPlan={setPlan} />
        ) : null}
        {tab === "activity" ? <ActivityPage /> : null}
      </main>

      <ConfirmPlanModal
        open={confirmOpen}
        plan={plan}
        busy={confirmBusy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirmPlan()}
      />
    </div>
  );
}
