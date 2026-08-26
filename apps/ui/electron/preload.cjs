const { contextBridge, ipcMain, ipcRenderer } = require("electron");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function socketPath() {
  if (process.env.ENVSYNC_SOCKET) return process.env.ENVSYNC_SOCKET;
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) return path.join(runtime, "envsyncd.sock");
  return path.join("/tmp", `envsync-${process.getuid()}.sock`);
}

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath(), () => {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      });
      client.write(payload + "\n");
    });

    let buffer = "";
    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        try {
          const msg = JSON.parse(buffer.slice(0, idx));
          if (msg.error) reject(new Error(msg.error.message || "IPC error"));
          else resolve(msg.result);
        } catch (error) {
          reject(error);
        } finally {
          client.end();
        }
      }
    });
    client.on("error", reject);
  });
}

contextBridge.exposeInMainWorld("envsync", {
  invoke: (method, params) => rpc(method, params),
  platform: os.platform(),
});
