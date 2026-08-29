import { Bonjour } from "bonjour-service";
import type { PeerInfo } from "@envsync/protocol";
import { PRODUCT_NAME } from "@envsync/protocol";
import type { DaemonStore } from "./store.js";

export const PEER_PORT = Number(process.env.ENVSYNC_PEER_PORT ?? 45771);
const SYNC_INTERVAL_MS = 4_000;

type MdnsService = {
  name: string;
  host: string;
  port: number;
  txt?: Record<string, unknown>;
  referer?: { address: string };
};

type MdnsBrowser = {
  on(event: string, listener: (service: MdnsService) => void): void;
  stop(): void;
  update(): void;
  expire(): void;
  services: MdnsService[];
};

export class DiscoveryService {
  private bonjour: Bonjour | null = null;
  private browser: MdnsBrowser | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: DaemonStore,
    private readonly fingerprint: string,
    private readonly port = PEER_PORT,
  ) {}

  start(): void {
    this.bonjour = new Bonjour();
    this.bonjour.publish({
      name: `${PRODUCT_NAME}-${this.store.getDeviceName()}-${this.fingerprint.slice(0, 8)}`,
      type: PRODUCT_NAME,
      port: this.port,
      txt: {
        fingerprint: this.fingerprint,
        deviceName: this.store.getDeviceName(),
      },
    });

    this.browser = this.bonjour.find({ type: PRODUCT_NAME }) as MdnsBrowser;
    this.browser.on("up", (service) => this.upsertFromService(service as MdnsService));
    this.browser.on("down", (service) => this.removeFromService(service as MdnsService));
    this.browser.on("srv-update", (service) =>
      this.upsertFromService(service as MdnsService),
    );
    this.browser.on("txt-update", (service) =>
      this.upsertFromService(service as MdnsService),
    );

    this.syncTimer = setInterval(() => this.refreshPeers(), SYNC_INTERVAL_MS);
    setTimeout(() => this.refreshPeers(), 1_500);
  }

  stop(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.browser?.stop();
    this.bonjour?.destroy();
    this.browser = null;
    this.bonjour = null;
  }

  private refreshPeers(): void {
    if (!this.browser) return;
    this.browser.update();
    this.browser.expire();
    this.syncFromBrowser();
  }

  private syncFromBrowser(): void {
    if (!this.browser) return;

    const liveIds = new Set<string>();
    for (const service of this.browser.services) {
      const peer = this.peerFromService(service);
      if (!peer) continue;
      liveIds.add(peer.id);
      this.store.upsertDiscovered(peer);
    }

    for (const peer of this.store.listDiscovered()) {
      if (!liveIds.has(peer.id)) {
        this.store.removeDiscovered(peer.id);
      }
    }
  }

  private upsertFromService(service: MdnsService): void {
    const peer = this.peerFromService(service);
    if (!peer) return;
    this.store.upsertDiscovered(peer);
  }

  private removeFromService(service: MdnsService): void {
    const fingerprint = String(service.txt?.fingerprint ?? "");
    if (fingerprint) this.store.removeDiscovered(fingerprint);
  }

  private peerFromService(service: MdnsService): PeerInfo | null {
    const fingerprint = String(service.txt?.fingerprint ?? "");
    if (!fingerprint || fingerprint === this.fingerprint) return null;

    const host = service.referer?.address ?? service.host;
    if (!host || host === "0.0.0.0") return null;

    return {
      id: fingerprint,
      name: String(service.txt?.deviceName ?? service.name),
      host,
      port: service.port,
      online: true,
      trusted: this.store.isTrusted(fingerprint),
      fingerprint,
    };
  }
}
