import { useState, useEffect, useRef, useCallback } from "react";
import { GearIcon, CloseIcon } from "./Icons";
import { getServerUrl, setServerUrl } from "../serverUrl";
import "./WindowSwitcher.css";

export interface WindowInfo {
    id: string;
    title: string;
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
    if (w.title) return w.title;
    return w.isDefault ? "默认" : "新窗口";
}

function SettingsModal({ onClose }: { onClose: () => void }) {
    const [url, setUrl] = useState(getServerUrl() || "");
    const [editing, setEditing] = useState(false);
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        setServerUrl(url.trim());
        setEditing(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <span className="settings-title">设置</span>
                    <button className="settings-close" onClick={onClose}>
                        <CloseIcon size={12} />
                    </button>
                </div>
                <div className="settings-body">
                    <div className="settings-row">
                        <label className="settings-label">服务器地址</label>
                        {editing ? (
                            <div className="settings-edit-row">
                                <input
                                    className="settings-input"
                                    type="url"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                                    autoFocus
                                />
                                <button className="settings-btn" onClick={handleSave}>保存</button>
                                <button className="settings-btn settings-btn-dim" onClick={() => { setEditing(false); setUrl(getServerUrl() || ""); }}>取消</button>
                            </div>
                        ) : (
                            <div className="settings-value-row">
                                <span className="settings-value">{getServerUrl() || "(未配置)"}</span>
                                <button className="settings-btn" onClick={() => setEditing(true)}>修改</button>
                            </div>
                        )}
                        {saved && <span className="settings-saved">✓ 已保存</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function WindowSwitcher({
    windows,
    activeWindowId,
    onSwitch,
    onCreate,
    onDelete,
}: WindowSwitcherProps) {
    const [popoverId, setPopoverId] = useState<string | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const taskbarRef = useRef<HTMLElement>(null);
    const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    // Tap outside taskbar to dismiss
    useEffect(() => {
        if (!popoverId) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            if (taskbarRef.current && !taskbarRef.current.contains(e.target as Node)) {
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
            if (!w.isDefault) {
                setPopoverId((prev) => {
                    if (prev === w.id) return null;
                    // Calculate position from button
                    const btn = btnRefs.current.get(w.id);
                    if (btn) {
                        const rect = btn.getBoundingClientRect();
                        setPopoverPos({ x: rect.left + rect.width / 2, y: rect.bottom });
                    }
                    return w.id;
                });
            }
        } else {
            setPopoverId(null);
            onSwitch(w.id);
        }
    }, [activeWindowId, onSwitch]);

    return (
        <>
            <nav className="taskbar" ref={taskbarRef}>
                <div className="taskbar-items">
                    {windows.map((w) => (
                        <button
                            key={w.id}
                            ref={(el) => { if (el) btnRefs.current.set(w.id, el); }}
                            className={`taskbar-item ${w.id === activeWindowId ? "active" : ""}`}
                            onClick={() => handleClick(w)}
                        >
                            <span className="taskbar-label">{windowLabel(w)}</span>
                        </button>
                    ))}
                </div>
                <button className="taskbar-add" onClick={onCreate} title="新建窗口">+</button>
                <button className="taskbar-gear" onClick={() => setShowSettings(true)} title="设置">
                    <GearIcon size={12} />
                </button>

                {popoverId && popoverPos && (
                    <div
                        className="taskbar-popover"
                        style={{ left: popoverPos.x, top: popoverPos.y }}
                    >
                        <button
                            className="taskbar-popover-btn"
                            onClick={() => {
                                const id = popoverId;
                                setPopoverId(null);
                                onDelete(id);
                            }}
                        >
                            关闭窗口
                        </button>
                    </div>
                )}
            </nav>

            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        </>
    );
}
