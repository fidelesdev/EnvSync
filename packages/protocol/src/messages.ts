export const PRODUCT_NAME = "envsync" as const;
export const IPC_SOCKET_NAME = "envsyncd.sock";

export type IpcMethod =
  | "daemon.ping"
  | "daemon.shutdown"
  | "catalog.list"
  | "selection.get"
  | "selection.set"
  | "peers.list"
  | "peers.pair"
  | "peers.unpair"
  | "sync.buildPlan"
  | "sync.confirm"
  | "sync.resolveConflict"
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

export type PlanAction = {
  itemId: string;
  kind: PlanActionKind;
  direction: "push" | "pull" | "none";
  summary: string;
  localFingerprint?: string;
  remoteFingerprint?: string;
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
