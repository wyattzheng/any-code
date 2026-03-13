import { useState, useRef, useCallback } from "react";
import "./ConversationOverlay.css";

export function ConversationOverlay() {
    const [input, setInput] = useState("");
    const [recording, setRecording] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

    const handleSend = () => {
        if (!input.trim()) return;
        // TODO: send message to server
        setInput("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleMicClick = () => {
        setRecording((v) => !v);
        // TODO: start/stop audio recording via Web Audio API
    };

    const onDragStart = useCallback((clientX: number, clientY: number) => {
        dragRef.current = { startX: clientX, startY: clientY, origX: position.x, origY: position.y };
    }, [position]);

    const onDragMove = useCallback((clientX: number, clientY: number) => {
        if (!dragRef.current) return;
        const dx = clientX - dragRef.current.startX;
        const dy = clientY - dragRef.current.startY;
        setPosition({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    }, []);

    const onDragEnd = useCallback(() => {
        dragRef.current = null;
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        onDragStart(e.clientX, e.clientY);
        const onMove = (ev: MouseEvent) => onDragMove(ev.clientX, ev.clientY);
        const onUp = () => { onDragEnd(); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        onDragStart(touch.clientX, touch.clientY);
        const onMove = (ev: TouchEvent) => { ev.preventDefault(); onDragMove(ev.touches[0].clientX, ev.touches[0].clientY); };
        const onUp = () => { onDragEnd(); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", onUp);
    };

    return (
        <div
            className="conversation-panel"
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        >
            <div
                className="conversation-header"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
            >
                💬 对话
            </div>

            <div className="conversation-messages">
                <div className="message assistant">
                    <p>你好！我是 AnyCode AI 助手。告诉我你想做什么，我来帮你写代码。</p>
                </div>
            </div>

            <div className="conversation-input">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入消息..."
                />
                <button
                    className={`mic-btn ${recording ? "recording" : ""}`}
                    onClick={handleMicClick}
                    title={recording ? "停止录音" : "开始录音"}
                >
                    🎤
                </button>
            </div>
        </div>
    );
}
