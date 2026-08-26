import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IpcHandler } from "./ipc-server.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(payload);
}

function defaultUiDist(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // apps/daemon/dist -> ../../ui/dist  OR apps/daemon/src via tsx -> ../ui/dist
  const candidates = [
    resolve(here, "../../ui/dist"),
    resolve(here, "../../../apps/ui/dist"),
    process.env.ENVSYNC_UI_DIST ?? "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return candidates[0] ?? resolve(here, "../../ui/dist");
}

export type HttpApiOptions = {
  host?: string;
  port?: number;
  uiDist?: string;
  handler: IpcHandler;
};

export class HttpApiServer {
  private readonly host: string;
  private readonly port: number;
  private readonly uiDist: string;
  private readonly handler: IpcHandler;

  constructor(options: HttpApiOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? Number(process.env.ENVSYNC_HTTP_PORT ?? 45770);
    this.uiDist = options.uiDist ?? defaultUiDist();
    this.handler = options.handler;
  }

  async start(): Promise<{ host: string; port: number; uiDist: string }> {
    const server = createServer((req, res) => {
      void this.onRequest(req, res);
    });

    await new Promise<void>((resolveListen, reject) => {
      server.listen(this.port, this.host, () => resolveListen());
      server.on("error", reject);
    });

    return { host: this.host, port: this.port, uiDist: this.uiDist };
  }

  private async onRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/rpc") {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as {
          id?: number | string;
          method?: string;
          params?: unknown;
        };
        if (!parsed.method) {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            id: parsed.id ?? null,
            error: { code: -32600, message: "method obrigatório" },
          });
          return;
        }
        const result = await this.handler(parsed.method, parsed.params ?? {});
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: parsed.id ?? 1,
          result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message },
        });
      }
      return;
    }

    if (method === "GET") {
      this.serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "method not allowed" });
  }

  private serveStatic(pathname: string, res: ServerResponse): void {
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(this.uiDist, safePath === "/" ? "index.html" : safePath);

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(this.uiDist, "index.html");
    }

    if (!existsSync(filePath)) {
      sendJson(res, 404, {
        error: "UI não encontrada — rode: pnpm --filter @envsync/ui build",
        uiDist: this.uiDist,
      });
      return;
    }

    const type = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    createReadStream(filePath).pipe(res);
  }
}
