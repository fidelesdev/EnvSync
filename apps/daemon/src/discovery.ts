import { Bonjour } from "bonjour-service";
import type { PeerInfo } from "@envsync/protocol";
import { PRODUCT_NAME } from "@envsync/protocol";
import type { DaemonStore } from "./store.js";

export const PEER_PORT = Number(process.env.ENVSYNC_PEER_PORT ?? 45771);

export class DiscoveryService {
  private bonjour: Bonjour | null = null;
  private browser: ReturnType<Bonjour["find"]> | null = null;

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

    this.browser = this.bonjour.find({ type: PRODUCT_NAME });
    this.browser.on("up", (service) => {
      const host = service.referer?.address ?? service.host;
      const fingerprint = String(service.txt?.fingerprint ?? "");
      if (!fingerprint || fingerprint === this.fingerprint) return;
      const peer: PeerInfo = {
        id: fingerprint,
        name: String(service.txt?.deviceName ?? service.name),
        host,
        port: service.port,
        online: true,
        trusted: this.store.isTrusted(fingerprint),
        fingerprint,
      };
      this.store.upsertDiscovered(peer);
    });
    this.browser.on("down", (service) => {
      const fingerprint = String(service.txt?.fingerprint ?? "");
      if (fingerprint) this.store.removeDiscovered(fingerprint);
    });
  }

  stop(): void {
    this.browser?.stop();
    this.bonjour?.destroy();
  }
}
