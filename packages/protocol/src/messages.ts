export const PRODUCT_NAME = "envsync" as const;
export const IPC_SOCKET_NAME = "envsyncd.sock";

export type IpcMethod =
  | "daemon.ping"
  | "daemon.shutdown"
  | "catalog.list"
  | "catalog.survey"
  | "catalog.surveyStatus"
  | "catalog.startSurvey"
  | "catalog.ensureSurvey"
  | "catalog.pickFolder"
  | "catalog.addCustomPath"
  | "catalog.removeItem"
  | "selection.get"
  | "selection.set"
  | "peers.list"
  | "peers.pair"
  | "peers.unpair"
  | "peers.select"
  | "peers.getSelected"
  | "sync.buildPlan"
  | "sync.confirm"
  | "sync.resolveConflict"
  | "sync.resolveConflictDetail"
  | "sync.status"
  | "activity.list"
  | "backup.restore";

export type PeerInfo = {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  trusted: boolean;
  fingerprint: string;
};

export type PlanActionKind = "install" | "copy" | "skip" | "conflict";

export type ConflictDetail = {
  id: string;
  label: string;
  kind: "path" | "package" | "env";
  localSummary: string;
  remoteSummary: string;
  diff?: string;
  localPreview?: string;
  remotePreview?: string;
  resolution?: ConflictChoice;
};

export type PlanAction = {
  itemId: string;
  kind: PlanActionKind;
  direction: "push" | "pull" | "none";
  summary: string;
  localFingerprint?: string;
  remoteFingerprint?: string;
  conflictDetails?: ConflictDetail[];
};

export type SyncPlan = {
  id: string;
  peerId: string;
  actions: PlanAction[];
  createdAt: string;
  confirmed: boolean;
};

export type ConflictChoice = "keep_local" | "accept_remote" | "skip";

export type ActivityEntry = {
  id: string;
  at: string;
  kind: string;
  message: string;
};

export type ApplyResult = {
  itemId: string;
  ok: boolean;
  message: string;
};

export type ConfirmPlanResult = {
  plan: SyncPlan;
  results: ApplyResult[];
};

export type CatalogSurveySectionId = "remoteOnly" | "both" | "localOnly";

export type CatalogSurveyItem = {
  id: string;
  label: string;
  groupId: string;
  source: "seed" | "discovered" | "custom";
  localPresent: boolean;
  remotePresent: boolean;
  inSync: boolean;
  detail?: string;
};

export type CatalogSurveySection = {
  id: CatalogSurveySectionId;
  title: string;
  items: CatalogSurveyItem[];
};

export type CatalogSurvey = {
  deviceName: string;
  peerDeviceName: string;
  groups: Array<{ id: string; label: string; icon: string }>;
  sections: CatalogSurveySection[];
};

export type CatalogSurveyStatus = "idle" | "running" | "done" | "error";

export type CatalogSurveyProgress = {
  peerId: string;
  status: CatalogSurveyStatus;
  phase: string;
  processed: number;
  total: number;
  identifiedCount: number;
  identified: CatalogSurveyItem[];
  sections: CatalogSurveySection[];
  survey: CatalogSurvey | null;
  error?: string;
  updatedAt: string;
};

export type CatalogSnapshot = {
  deviceName: string;
  items: Array<{
    id: string;
    label: string;
    groupId: string;
    providers: unknown[];
  }>;
};
