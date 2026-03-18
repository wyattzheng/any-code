import { useState, useEffect, useRef, useCallback } from "react";
import "./WindowSwitcher.css";

export interface WindowInfo {
    id: string;
    directory: string;
    isDefault: boolean;
    createdAt: number;
}

interface WindowSwitcherProps {
    windows: WindowInfo[];
    activeWindowId: string;
    onSwitch: (id: string) => void;
    onCreate: () => void;
    onDelete: (id: string) => void;
}

function windowLabel(w: WindowInfo): string {
    if (w.directory) {
        const parts = w.directory.split("/");
        return parts[parts.length - 1] || w.directory;
    }
    return w.isDefault ? "默认" : "新窗口";
}

export function WindowSwitcher({
    windows,
    activeWindowId,
    onSwitch,
    onCreate,
    onDelete,
}: WindowSwitcherProps) {
    const [popoverId, setPopoverId] = useState<string | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Tap outside to dismiss
    useEffect(() => {
        if (!popoverId) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setPopoverId(null);
            }
        };
        document.addEventListener("mousedown", handler);
        document.addEventListener("touchstart", handler);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("touchstart", handler);
        };
    }, [popoverId]);

    const handleClick = useCallback((w: WindowInfo) => {
        if (w.id === activeWindowId) {
            // Already active — toggle popover (only for non-default)
            if (!w.isDefault) {
                setPopoverId((prev) => (prev === w.id ? null : w.id));
            }
        } else {
            setPopoverId(null);
            onSwitch(w.id);
        }
    }, [activeWindowId, onSwitch]);

    return (
        <nav className="taskbar">
            <div className="taskbar-items">
                {windows.map((w) => (
                    <button
                        key={w.id}
                        className={`taskbar-item ${w.id === activeWindowId ? "active" : ""}`}
                        onClick={() => handleClick(w)}
                    >
                        <span className="taskbar-label">{windowLabel(w)}</span>
                        {popoverId === w.id && (
                            <div className="taskbar-popover" ref={popoverRef}>
                                <button
                                    className="taskbar-popover-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setPopoverId(null);
                                        onDelete(w.id);
                                    }}
                                >
                                    关闭窗口
                                </button>
                            </div>
                        )}
                    </button>
                ))}
            </div>
            <button className="taskbar-add" onClick={onCreate} title="新建窗口">+</button>
        </nav>
    );
}
