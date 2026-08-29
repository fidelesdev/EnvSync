import { join } from "node:path";
import { dataDir, socketPath } from "@envsync/core";
import { PRODUCT_NAME } from "@envsync/protocol";
import { CatalogService } from "./catalog-service.js";
import { DiscoveryService } from "./discovery.js";
import { createHandlers } from "./handlers.js";
import { HttpApiServer } from "./http-api.js";
import { loadOrCreateIdentity } from "./identity.js";
import { IpcServer } from "./ipc-server.js";
import { TlsPeerServer, TlsPeerTransport } from "./peer-server.js";
import { DaemonStore } from "./store.js";
import { SyncSessionService } from "./sync-session.js";

async function main(): Promise<void> {
  const root = dataDir();
  const store = new DaemonStore(root);
  const identity = loadOrCreateIdentity(join(root, "certs"));
  const transport = new TlsPeerTransport(identity);
  const catalog = new CatalogService(store, transport, identity.fingerprint);
  const sync = new SyncSessionService(store, transport, catalog);
  const handlers = createHandlers(store, identity, sync, catalog);

  const ipc = new IpcServer(socketPath(), handlers);
  await ipc.start();

  const http = new HttpApiServer({ handler: handlers });
  const httpInfo = await http.start();

  const peerServer = new TlsPeerServer(identity, store, catalog);
  peerServer.start();

  const discovery = new DiscoveryService(store, identity.fingerprint);
  discovery.start();

  catalog.bootstrapSurveys();
  setInterval(() => catalog.bootstrapSurveys(), 30_000);

  store.addActivity(
    "start",
    `${PRODUCT_NAME} daemon ativo — fp ${identity.fingerprint.slice(0, 12)}…`,
  );

  console.log(
    JSON.stringify({
      event: "started",
      product: PRODUCT_NAME,
      socket: socketPath(),
      http: `http://${httpInfo.host}:${httpInfo.port}`,
      uiDist: httpInfo.uiDist,
      fingerprint: identity.fingerprint,
      dataDir: root,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
