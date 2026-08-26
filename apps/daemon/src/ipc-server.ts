import { createServer, type Server, type Socket } from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import {
  encodeJsonRpcError,
  encodeJsonRpcResult,
  parseJsonRpcLine,
  type JsonRpcRequest,
} from "@envsync/protocol";

export type IpcHandler = (
  method: string,
  params: unknown,
) => Promise<unknown> | unknown;

export class IpcServer {
  private server: Server | null = null;

  constructor(
    private readonly socketPath: string,
    private readonly handler: IpcHandler,
  ) {}

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // ignore
      }
    }

    this.server = createServer((socket) => this.onConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.socketPath, () => resolve());
      this.server?.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
  }

  private onConnection(socket: Socket): void {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        void this.handleLine(socket, line);
        newline = buffer.indexOf("\n");
      }
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    try {
      const msg = parseJsonRpcLine(line);
      if (!("method" in msg)) {
        socket.write(
          encodeJsonRpcError(null, -32600, "Expected JSON-RPC request"),
        );
        return;
      }
      const request = msg as JsonRpcRequest;
      const result = await this.handler(request.method, request.params ?? {});
      socket.write(encodeJsonRpcResult(request.id, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      socket.write(encodeJsonRpcError(null, -32000, message));
    }
  }
}
