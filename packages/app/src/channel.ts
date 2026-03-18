// ── Channel abstraction ─────────────────────────────────────────────────────
// Unified interface for real-time bidirectional communication.
// Two implementations: WebSocket (default) and HTTP long-polling (fallback).

export interface Channel {
    send(data: any): void;
    close(): void;
    onopen: (() => void) | null;
    onmessage: ((data: any) => void) | null;
    onclose: (() => void) | null;
    readonly readyState: number;
}

export const ReadyState = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
} as const;

// ── WebSocket implementation ────────────────────────────────────────────────

export class WebSocketChannel implements Channel {
    private ws: WebSocket;
    onopen: (() => void) | null = null;
    onmessage: ((data: any) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string) {
        this.ws = new WebSocket(url);
        this.ws.onopen = () => this.onopen?.();
        this.ws.onmessage = (e) => {
            try { this.onmessage?.(JSON.parse(e.data)); } catch { /* ignore */ }
        };
        this.ws.onclose = () => this.onclose?.();
        this.ws.onerror = () => {};
    }

    get readyState() { return this.ws.readyState; }

    send(data: any) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    close() { this.ws.close(); }
}

// ── HTTP Long-Polling implementation ────────────────────────────────────────

export class HttpPollingChannel implements Channel {
    private channelId: string | null = null;
    private _readyState: number = ReadyState.CONNECTING;
    private pollAbort: AbortController | null = null;
    private disposed = false;
    private baseUrl: string;
    private sessionId: string;

    onopen: (() => void) | null = null;
    onmessage: ((data: any) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(baseUrl: string, sessionId: string) {
        this.baseUrl = baseUrl;
        this.sessionId = sessionId;
        this.init();
    }

    get readyState() { return this._readyState; }

    private async init() {
        try {
            const res = await fetch(`${this.baseUrl}/api/poll/connect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: this.sessionId }),
            });
            if (!res.ok) throw new Error("Connect failed");
            const { channelId } = await res.json();
            this.channelId = channelId;
            this._readyState = ReadyState.OPEN;
            this.onopen?.();
            this.poll();
        } catch {
            this._readyState = ReadyState.CLOSED;
            this.onclose?.();
        }
    }

    private async poll() {
        while (!this.disposed && this.channelId) {
            try {
                this.pollAbort = new AbortController();
                const res = await fetch(
                    `${this.baseUrl}/api/poll?channelId=${encodeURIComponent(this.channelId)}`,
                    { signal: this.pollAbort.signal },
                );
                if (!res.ok) throw new Error("Poll failed");
                const messages: any[] = await res.json();
                for (const msg of messages) {
                    this.onmessage?.(msg);
                }
            } catch (e: any) {
                if (this.disposed) break;
                if (e.name === "AbortError") continue;
                // Network error — wait before retrying
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        if (!this.disposed) {
            this._readyState = ReadyState.CLOSED;
            this.onclose?.();
        }
    }

    send(data: any) {
        if (!this.channelId || this._readyState !== ReadyState.OPEN) return;
        fetch(`${this.baseUrl}/api/poll/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelId: this.channelId, data }),
        }).catch(() => {});
    }

    close() {
        this.disposed = true;
        this._readyState = ReadyState.CLOSED;
        this.pollAbort?.abort();
        if (this.channelId) {
            fetch(`${this.baseUrl}/api/poll/close`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channelId: this.channelId }),
            }).catch(() => {});
        }
    }
}

// ── Factory ─────────────────────────────────────────────────────────────────

declare global {
    interface Window {
        __ANYCODE_CONFIG__?: { webSocket?: boolean };
    }
}

export function createChannel(sessionId: string): Channel {
    // URL param override: ?transport=ws or ?transport=polling
    const params = new URLSearchParams(location.search);
    const transport = params.get("transport");

    // Determine: URL param > server config > default (polling)
    const useWebSocket = transport
        ? transport === "ws"
        : window.__ANYCODE_CONFIG__?.webSocket === true; // default false → polling

    if (useWebSocket) {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        return new WebSocketChannel(`${protocol}//${location.host}/?sessionId=${sessionId}`);
    }

    return new HttpPollingChannel(location.origin, sessionId);
}
