import http from "node:http";
import { randomUUID } from "node:crypto";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("desktop-auth-callback");
const MAX_BODY_BYTES = 64 * 1024;

type DesktopAuthPayload = {
  token: string;
  refreshToken?: string;
};

type CallbackHandler = (payload: DesktopAuthPayload) => Promise<void>;

type CallbackRequestBody = {
  token?: unknown;
  accessToken?: unknown;
  access_token?: unknown;
  refreshToken?: unknown;
  refresh_token?: unknown;
  nonce?: unknown;
};

export class DesktopAuthCallbackService {
  private server: http.Server | null = null;
  private port: number | null = null;
  private nonce = randomUUID();
  private handler: CallbackHandler | null = null;

  async getCallbackParams(handler: CallbackHandler): Promise<{ port: number; nonce: string }> {
    this.handler = handler;
    await this.ensureStarted();
    if (this.port === null) {
      throw new Error("Desktop auth callback server did not start.");
    }
    this.nonce = randomUUID();
    return { port: this.port, nonce: this.nonce };
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = null;
    this.handler = null;
  }

  private async ensureStarted(): Promise<void> {
    if (this.server && this.port !== null) return;

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();
        if (typeof address === "object" && address?.port) {
          this.port = address.port;
          log.info("Desktop auth callback server started", { port: this.port });
          resolve();
          return;
        }
        reject(new Error("Desktop auth callback server address was unavailable."));
      });
    });
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    this.writeCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method !== "POST" || request.url?.split("?")[0] !== "/auth/callback") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
      return;
    }

    try {
      const body = await this.readJsonBody(request);
      const nonce = typeof body.nonce === "string" ? body.nonce : "";
      if (!nonce || nonce !== this.nonce) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false }));
        log.warn("Rejected desktop auth callback with invalid nonce");
        return;
      }

      const token = readString(body.token ?? body.accessToken ?? body.access_token);
      const refreshToken = readString(body.refreshToken ?? body.refresh_token);
      if (!token) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false }));
        log.warn("Rejected desktop auth callback without token");
        return;
      }

      if (!this.handler) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false }));
        log.warn("Rejected desktop auth callback before handler was ready");
        return;
      }

      await this.handler({ token, refreshToken: refreshToken || undefined });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      log.info("Desktop auth callback accepted", { hasRefreshToken: Boolean(refreshToken) });
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
      log.error("Desktop auth callback failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private writeCorsHeaders(request: http.IncomingMessage, response: http.ServerResponse): void {
    const origin = request.headers.origin;
    if (typeof origin === "string") {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
  }

  private async readJsonBody(request: http.IncomingMessage): Promise<CallbackRequestBody> {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_BODY_BYTES) {
        throw new Error("Desktop auth callback body was too large.");
      }
      chunks.push(buffer);
    }

    const text = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(text) as CallbackRequestBody;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const desktopAuthCallbackService = new DesktopAuthCallbackService();
