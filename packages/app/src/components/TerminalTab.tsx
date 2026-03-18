import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./TerminalTab.css";

interface TerminalTabProps {
    sessionId: string;
}

export function TerminalTab({ sessionId }: TerminalTabProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            theme: {
                background: "#1e1e1e",
                foreground: "#d4d4d4",
                cursor: "#d4d4d4",
                selectionBackground: "rgba(255, 255, 255, 0.2)",
                black: "#1e1e1e",
                red: "#f14c4c",
                green: "#89d185",
                yellow: "#cca700",
                blue: "#0078d4",
                magenta: "#c586c0",
                cyan: "#4ec9b0",
                white: "#d4d4d4",
                brightBlack: "#858585",
                brightRed: "#f14c4c",
                brightGreen: "#89d185",
                brightYellow: "#cca700",
                brightBlue: "#0078d4",
                brightMagenta: "#c586c0",
                brightCyan: "#4ec9b0",
                brightWhite: "#ffffff",
            },
            cursorBlink: true,
            scrollback: 5000,
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();

        termRef.current = term;
        fitRef.current = fitAddon;

        // WebSocket connection to server PTY
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(
            `${protocol}//${location.host}/terminal?sessionId=${sessionId}`
        );
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    type: "terminal.resize",
                    cols: term.cols,
                    rows: term.rows,
                })
            );
        };

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === "terminal.output") {
                    term.write(msg.data);
                } else if (msg.type === "terminal.exited") {
                    term.write(
                        `\r\n\x1b[90m[终端已退出 (code ${msg.exitCode})]\x1b[0m\r\n`
                    );
                } else if (msg.type === "terminal.ready") {
                    // Terminal already exists on server, send resize
                    ws.send(
                        JSON.stringify({
                            type: "terminal.resize",
                            cols: term.cols,
                            rows: term.rows,
                        })
                    );
                }
            } catch {
                /* ignore malformed */
            }
        };

        ws.onclose = () => {
            term.write("\r\n\x1b[90m[连接已断开]\x1b[0m\r\n");
        };

        // Forward user input to server
        const inputDisposable = term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "terminal.input", data }));
            }
        });

        // Handle resize
        const sendResize = () => {
            fitAddon.fit();
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        type: "terminal.resize",
                        cols: term.cols,
                        rows: term.rows,
                    })
                );
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            sendResize();
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            inputDisposable.dispose();
            ws.close();
            term.dispose();
            termRef.current = null;
            wsRef.current = null;
            fitRef.current = null;
        };
    }, [sessionId]);

    return <div className="terminal-tab" ref={containerRef} />;
}
