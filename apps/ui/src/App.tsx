import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc } from "./ipc/client";
import { ConfirmPlanModal } from "./components/ConfirmPlanModal";
import { ActivityPage } from "./pages/ActivityPage";
import { CatalogPage } from "./pages/CatalogPage";
import { ConflictsPage } from "./pages/ConflictsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { PlanPage } from "./pages/PlanPage";
import type { CatalogSurveyProgress, ConflictDetail, ApplyResult } from "@envsync/protocol";
import { formatBuildLabel, UI_BUILD, UI_VERSION } from "./build-info";

type Tab = "devices" | "catalog" | "plan" | "conflicts" | "activity";

type Ping = {
  ok: boolean;
  version?: string;
  build?: string;
  fingerprint: string;
  deviceName: string;
};

type Peer = {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  trusted: boolean;
  fingerprint: string;
};

export type ApplyResultView = ApplyResult;

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
  const [peers, setPeers] = useState<Peer[]>([]);
  const [surveyProgress, setSurveyProgress] = useState<CatalogSurveyProgress | null>(
    null,
  );
  const [plan, setPlan] = useState<SyncPlanView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);

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

  useEffect(() => {
    void ipc<{ peerId: string }>("peers.getSelected")
      .then((result) => {
        if (result.peerId) setSelectedPeerId(result.peerId);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;

    const pollPeers = async () => {
      try {
        const result = await ipc<{ peers: Peer[] }>("peers.list");
        if (!active) return;
        setPeers(result.peers);
        setSelectedPeerId((current) => {
          if (current && !result.peers.some((peer) => peer.id === current)) {
            return "";
          }
          return current;
        });
      } catch {
        // ignore transient errors while polling
      }
    };

    void pollPeers();
    const id = window.setInterval(() => void pollPeers(), 2_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const startSurvey = useCallback((peerId: string) => {
    if (!peerId) return;
    void ipc<CatalogSurveyProgress>("catalog.startSurvey", { peerId }).catch(
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!selectedPeerId) {
      setSurveyProgress(null);
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const progress = await ipc<CatalogSurveyProgress>("catalog.surveyStatus", {
          peerId: selectedPeerId,
        });
        if (!active) return;
        if (progress.status === "idle") {
          setSurveyProgress(null);
          return;
        }
        setSurveyProgress(progress);
      } catch {
        // ignore transient errors while polling
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 600);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [selectedPeerId]);

  const conflictCount = useMemo(
    () => plan?.actions.filter((action) => action.kind === "conflict").length ?? 0,
    [plan],
  );

  const catalogBadge = useMemo(() => {
    if (!surveyProgress || surveyProgress.peerId !== selectedPeerId) return "";
    if (surveyProgress.status === "running") return " …";
    if (surveyProgress.status === "done") {
      return ` (${surveyProgress.identifiedCount})`;
    }
    return "";
  }, [surveyProgress, selectedPeerId]);

  async function confirmPlan() {
    if (!plan) return;
    setConfirmBusy(true);
    setApplyResults(null);
    try {
      const response = await ipc<{ plan: SyncPlanView; results: ApplyResult[] }>(
        "sync.confirm",
        { planId: plan.id },
      );
      setPlan(response.plan);
      setApplyResults(response.results);
      setConfirmOpen(false);
      setTab("plan");
      if (response.plan.actions.some((action) => action.kind === "conflict")) {
        setTab("conflicts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function handleSelectPeer(peerId: string) {
    setSelectedPeerId(peerId);
    setSurveyProgress(null);
    await ipc("peers.select", { peerId });
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
                {entry.id === "catalog" ? catalogBadge : ""}
              </span>
            </button>
          ))}
        </div>

        <footer className="sidebar-version" aria-label="Versões">
          <span className="mono">{formatBuildLabel("UI", UI_VERSION, UI_BUILD)}</span>
          {ping?.version ? (
            <span className="mono">
              {formatBuildLabel(
                "daemon",
                ping.version,
                ping.build ?? "?",
              )}
            </span>
          ) : (
            <span className="mono muted">daemon —</span>
          )}
        </footer>
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
            peers={peers}
            selectedPeerId={selectedPeerId}
            onSelectPeer={(peerId) => void handleSelectPeer(peerId)}
          />
        ) : null}
        {tab === "catalog" ? (
          <CatalogPage
            selectedPeerId={selectedPeerId}
            selectedPeerName={
              peers.find((peer) => peer.id === selectedPeerId)?.name ?? "peer"
            }
            surveyProgress={surveyProgress}
            onStartSurvey={startSurvey}
          />
        ) : null}
        {tab === "plan" ? (
          <PlanPage
            selectedPeerId={selectedPeerId}
            plan={plan}
            applyResults={applyResults}
            onPlan={setPlan}
            onApplyResults={setApplyResults}
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
