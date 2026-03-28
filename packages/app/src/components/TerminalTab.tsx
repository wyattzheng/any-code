import { useEffect, useRef, useState } from "react";
import { TerminalClient, type AliveState } from "./TerminalClient";
import { TerminalIcon } from "./Icons";
import "@xterm/xterm/css/xterm.css";
import "./TerminalTab.css";

interface TerminalTabProps {
    sessionId: string;
}

export function TerminalTab({ sessionId }: TerminalTabProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [alive, setAlive] = useState<AliveState>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const client = new TerminalClient(containerRef.current, sessionId);
        client.onAliveChange = setAlive;

        return () => client.dispose();
    }, [sessionId]);

    return (
        <div className="terminal-tab">
            <div
                ref={containerRef}
                className="terminal-xterm"
                style={{ display: alive ? "block" : "none" }}
            />
            {alive === false && (
                <div className="terminal-empty">
                    <TerminalIcon size={36} />
                    <p>终端未启动</p>
                </div>
            )}
        </div>
    );
}
