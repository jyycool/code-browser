// A minimal Chrome DevTools Protocol client over one browser-level WebSocket (flat sessions).
// It never sends Runtime.enable or injects scripts: the shell only manages targets and navigation.
import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface CdpTransport extends EventEmitter {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  close(): void;
}

export class Cdp extends EventEmitter implements CdpTransport {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly ws: WebSocket) {
    super();
    ws.on("message", (data) => this.onMessage(String(data)));
    ws.on("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
      this.pending.clear();
      this.emit("disconnected");
    });
    ws.on("error", () => { /* "close" follows */ });
  }

  /** Connect to the browser endpoint behind `http://host:port` (reads /json/version). */
  static async connect(httpBase: string, timeoutMs = 10_000): Promise<Cdp> {
    const r = await fetch(`${httpBase}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    const { webSocketDebuggerUrl } = (await r.json()) as { webSocketDebuggerUrl?: string };
    if (!webSocketDebuggerUrl) throw new Error("浏览器没有返回 CDP WebSocket 地址");
    const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("连接 CDP 超时")), timeoutMs);
      ws.once("open", () => { clearTimeout(t); resolve(); });
      ws.once("error", (e) => { clearTimeout(t); reject(e); });
    });
    return new Cdp(ws);
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("CDP connection is not open"));
        return;
      }
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  close(): void {
    try { this.ws.close(); } catch { /* already closed */ }
  }

  private onMessage(text: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try { msg = JSON.parse(text); } catch { return; }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) this.emit("event", { method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId } satisfies CdpEvent);
  }
}
