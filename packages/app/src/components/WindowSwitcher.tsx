import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GearIcon, CloseIcon } from "./Icons";
import { getApiBase, getServerUrl, setServerUrl } from "../server-url";
import "./WindowSwitcher.css";

export interface WindowInfo {
    id: string;
    title: string;
    directory: string;
    isDefault: boolean;
    createdAt: number;
}

interface AccountInfo {
    id: string;
    name: string;
    AGENT: string;
    PROVIDER: string;
    MODEL: string;
    API_KEY: string;
    BASE_URL?: string;
}

interface SettingsResponse {
    accounts: AccountInfo[];
    currentAccountId: string | null;
}

interface ApiResponseBody {
    error?: string;
    code?: string;
}

interface WindowSwitcherProps {
    windows: WindowInfo[];
    activeWindowId: string;
    onSwitch: (id: string) => void;
    onCreate: () => void;
    onDelete: (id: string) => void;
    onSettingsSaved?: () => void;
    creating?: boolean;
}

function windowLabel(w: WindowInfo): string {
    if (w.directory) {
        const parts = w.directory.split("/");
        return parts[parts.length - 1] || w.directory;
    }
    if (w.title) return w.title;
    return w.isDefault ? "默认" : "新窗口";
}

function createAccount(): AccountInfo {
    return {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `account-${Date.now()}`,
        name: "新账号",
        AGENT: "anycode",
        PROVIDER: "anthropic",
        MODEL: "claude-sonnet-4-20250514",
        API_KEY: "",
        BASE_URL: "",
    };
}

function createApiError(res: Response, body: ApiResponseBody, fallbackMessage: string) {
    const error = new Error(body.error || fallbackMessage) as Error & { code?: string; status?: number };
    error.code = body.code;
    error.status = res.status;
    return error;
}

async function readResponseJson<T>(res: Response): Promise<T & ApiResponseBody> {
    const text = await res.text();
    if (!text.trim()) {
        if (!res.ok) throw new Error("服务端返回空响应");
        return {} as T & ApiResponseBody;
    }
    try {
        return JSON.parse(text) as T & ApiResponseBody;
    } catch {
        throw new Error(text);
    }
}

function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
    const [url, setUrl] = useState(getServerUrl() || "");
    const [editingServerUrl, setEditingServerUrl] = useState(false);

    const [accounts, setAccounts] = useState<AccountInfo[]>([]);
    const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [dirty, setDirty] = useState(false);

    const selectedAccount = useMemo(
        () => accounts.find((account) => account.id === selectedAccountId) ?? null,
        [accounts, selectedAccountId],
    );

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`${getApiBase()}/api/settings`);
            const data = await readResponseJson<SettingsResponse>(res);
            if (!res.ok || data.error) throw createApiError(res, data, `HTTP ${res.status}`);
            setAccounts(data.accounts ?? []);
            setCurrentAccountId(data.currentAccountId ?? data.accounts?.[0]?.id ?? null);
            setSelectedAccountId((prev) => prev && data.accounts?.some((item) => item.id === prev)
                ? prev
                : (data.currentAccountId ?? data.accounts?.[0]?.id ?? null));
        } catch (e: any) {
            setError(e?.message || "读取账号配置失败");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const sanitizeAccounts = useCallback((items: AccountInfo[]) => (
        items.map((account) => ({
            ...account,
            name: account.name.trim(),
            AGENT: account.AGENT.trim(),
            PROVIDER: account.PROVIDER.trim(),
            MODEL: account.MODEL.trim(),
            API_KEY: account.API_KEY.trim(),
            BASE_URL: account.BASE_URL?.trim() || "",
        }))
    ), []);

    const persistSettings = useCallback(async (
        nextAccounts: AccountInfo[],
        nextCurrentAccountId: string | null,
        options?: { applyCurrentAccount?: boolean; nextSelectedAccountId?: string | null; closeOnMobile?: boolean },
    ) => {
        setSaving(true);
        setError("");
        try {
            const res = await fetch(`${getApiBase()}/api/settings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accounts: sanitizeAccounts(nextAccounts),
                    currentAccountId: nextCurrentAccountId,
                    applyCurrentAccount: options?.applyCurrentAccount === true,
                }),
            });
            const data = await readResponseJson<SettingsResponse>(res);
            if (!res.ok || data.error) throw createApiError(res, data, `HTTP ${res.status}`);

            const resolvedAccounts = data.accounts ?? [];
            const resolvedCurrentAccountId = data.currentAccountId ?? null;
            const preferredSelectedId = options?.nextSelectedAccountId ?? selectedAccountId;

            setAccounts(resolvedAccounts);
            setCurrentAccountId(resolvedCurrentAccountId);
            setSelectedAccountId(
                preferredSelectedId && resolvedAccounts.some((account) => account.id === preferredSelectedId)
                    ? preferredSelectedId
                    : (resolvedCurrentAccountId ?? resolvedAccounts[0]?.id ?? null),
            );
            setDirty(false);
            onSaved?.();
            if (options?.closeOnMobile && typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches) {
                onClose();
            }
            return true;
        } catch (e: any) {
            setError(e?.message || "保存账号配置失败");
            return false;
        } finally {
            setSaving(false);
        }
    }, [onClose, onSaved, sanitizeAccounts, selectedAccountId]);

    const handleSaveServerUrl = () => {
        setServerUrl(url.trim());
        setEditingServerUrl(false);
    };

    const updateSelectedAccount = (patch: Partial<AccountInfo>) => {
        if (!selectedAccountId) return;
        setAccounts((prev) => prev.map((account) => (
            account.id === selectedAccountId ? { ...account, ...patch } : account
        )));
        setDirty(true);
    };

    const handleAddAccount = async () => {
        const account = createAccount();
        const nextAccounts = [...accounts, account];
        const nextCurrentAccountId = currentAccountId;
        setAccounts(nextAccounts);
        setSelectedAccountId(account.id);
        const ok = await persistSettings(nextAccounts, nextCurrentAccountId, { nextSelectedAccountId: account.id });
        if (!ok) setDirty(true);
    };

    const handleDeleteAccount = async () => {
        if (!selectedAccountId) return;
        const remaining = accounts.filter((account) => account.id !== selectedAccountId);
        const deletingCurrent = currentAccountId === selectedAccountId;
        const nextCurrentAccountId = deletingCurrent ? null : currentAccountId;
        const nextSelectedAccountId = remaining[0]?.id ?? null;
        setAccounts(remaining);
        setCurrentAccountId(nextCurrentAccountId);
        setSelectedAccountId(nextSelectedAccountId);
        const ok = await persistSettings(remaining, nextCurrentAccountId, {
            applyCurrentAccount: deletingCurrent,
            nextSelectedAccountId,
        });
        if (!ok) setDirty(true);
    };

    const handleActivateSelectedAccount = async () => {
        if (!selectedAccount) return;
        const ok = await persistSettings(accounts, selectedAccount.id, {
            applyCurrentAccount: true,
            nextSelectedAccountId: selectedAccount.id,
            closeOnMobile: true,
        });
        if (ok) {
            setCurrentAccountId(selectedAccount.id);
        }
    };

    const handleClose = useCallback(async () => {
        if (saving) return;
        if (!dirty) {
            onClose();
            return;
        }
        const ok = await persistSettings(accounts, currentAccountId, {
            nextSelectedAccountId: selectedAccountId,
        });
        if (ok) onClose();
    }, [accounts, currentAccountId, dirty, onClose, persistSettings, saving, selectedAccountId]);

    return (
        <div className="settings-overlay" onClick={() => { void handleClose(); }}>
            <div className="settings-modal settings-modal-wide" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <span className="settings-title">设置</span>
                    <button className="settings-close" onClick={() => { void handleClose(); }}>
                        <CloseIcon size={12} />
                    </button>
                </div>
                <div className="settings-body settings-body-stack">
                    <div className="settings-section">
                        <div className="settings-section-head">
                            <span className="settings-section-title">服务器</span>
                        </div>
                        <div className="settings-row">
                            <label className="settings-label">服务器地址</label>
                            {editingServerUrl ? (
                                <div className="settings-edit-row">
                                    <input
                                        className="settings-input"
                                        type="url"
                                        value={url}
                                        onChange={(e) => setUrl(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleSaveServerUrl()}
                                        autoFocus
                                    />
                                    <button className="settings-btn" onClick={handleSaveServerUrl}>保存</button>
                                    <button
                                        className="settings-btn settings-btn-dim"
                                        onClick={() => {
                                            setEditingServerUrl(false);
                                            setUrl(getServerUrl() || "");
                                        }}
                                    >
                                        取消
                                    </button>
                                </div>
                            ) : (
                                <div className="settings-value-row">
                                    <span className="settings-value">{getServerUrl() || "(未配置)"}</span>
                                    <button className="settings-btn" onClick={() => setEditingServerUrl(true)}>修改</button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="settings-section">
                        <div className="settings-section-head settings-section-head-sticky">
                            <span className="settings-section-title">账号</span>
                            <div className="settings-actions">
                                <button className="settings-btn" onClick={handleAddAccount}>新增账号</button>
                                <button
                                    className="settings-btn settings-btn-dim"
                                    onClick={handleDeleteAccount}
                                    disabled={!selectedAccount}
                                >
                                    删除账号
                                </button>
                            </div>
                        </div>

                        {loading ? (
                            <div className="settings-placeholder">读取账号配置中…</div>
                        ) : (
                            <div className="settings-accounts-layout">
                                <div className="settings-account-list">
                                    {accounts.map((account) => (
                                        <button
                                            key={account.id}
                                            className={`settings-account-item ${account.id === selectedAccountId ? "active" : ""}`}
                                            onClick={() => setSelectedAccountId(account.id)}
                                        >
                                            <span className="settings-account-name">{account.name || "未命名账号"}</span>
                                            <span className="settings-account-meta">{account.AGENT} / {account.PROVIDER} / {account.MODEL}</span>
                                            {account.id === currentAccountId && <span className="settings-account-badge">当前</span>}
                                        </button>
                                    ))}
                                </div>

                                <div className="settings-account-editor">
                                    {selectedAccount ? (
                                        <>
                                            <div className="settings-grid">
                                                <div className="settings-row">
                                                    <label className="settings-label">账号名称</label>
                                                    <input
                                                        className="settings-input"
                                                        value={selectedAccount.name}
                                                        onChange={(e) => updateSelectedAccount({ name: e.target.value })}
                                                    />
                                                </div>
                                                <div className="settings-row">
                                                    <label className="settings-label">AGENT</label>
                                                    <select
                                                        className="settings-input"
                                                        value={selectedAccount.AGENT}
                                                        onChange={(e) => updateSelectedAccount({ AGENT: e.target.value })}
                                                    >
                                                        <option value="anycode">anycode</option>
                                                        <option value="claudecode">claudecode</option>
                                                        <option value="codex">codex</option>
                                                        <option value="antigravity">antigravity</option>
                                                    </select>
                                                </div>
                                                <div className="settings-row">
                                                    <label className="settings-label">PROVIDER</label>
                                                    <input
                                                        className="settings-input"
                                                        value={selectedAccount.PROVIDER}
                                                        onChange={(e) => updateSelectedAccount({ PROVIDER: e.target.value })}
                                                        placeholder="anthropic / openai / google"
                                                    />
                                                </div>
                                                <div className="settings-row">
                                                    <label className="settings-label">MODEL</label>
                                                    <input
                                                        className="settings-input"
                                                        value={selectedAccount.MODEL}
                                                        onChange={(e) => updateSelectedAccount({ MODEL: e.target.value })}
                                                        placeholder="claude-sonnet-4-20250514 / gpt-4.1"
                                                    />
                                                </div>
                                                <div className="settings-row">
                                                    <label className="settings-label">BASE_URL</label>
                                                    <input
                                                        className="settings-input"
                                                        type="url"
                                                        value={selectedAccount.BASE_URL || ""}
                                                        onChange={(e) => updateSelectedAccount({ BASE_URL: e.target.value })}
                                                        placeholder="https://api.example.com/v1"
                                                    />
                                                </div>
                                            </div>

                                            <div className="settings-row">
                                                <label className="settings-label">API_KEY</label>
                                                <input
                                                    className="settings-input"
                                                    type="password"
                                                    value={selectedAccount.API_KEY}
                                                    onChange={(e) => updateSelectedAccount({ API_KEY: e.target.value })}
                                                    placeholder="输入 API Key"
                                                />
                                            </div>

                                            <div className="settings-value-row">
                                                <button
                                                    className="settings-btn settings-btn-primary"
                                                    onClick={handleActivateSelectedAccount}
                                                    disabled={saving}
                                                >
                                                    {saving
                                                        ? "切换中…"
                                                        : (selectedAccount.id === currentAccountId ? "应用当前账号" : "设为当前账号")}
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="settings-placeholder">请选择一个账号</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {error && <div className="settings-error">{error}</div>}
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
    onSettingsSaved,
    creating = false,
}: WindowSwitcherProps) {
    const [popoverId, setPopoverId] = useState<string | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const taskbarRef = useRef<HTMLElement>(null);
    const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
                <button className="taskbar-add" onClick={onCreate} disabled={creating} title="新建窗口">{creating ? "…" : "+"}</button>
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

            {showSettings && (
                <SettingsModal
                    onClose={() => setShowSettings(false)}
                    onSaved={onSettingsSaved}
                />
            )}
        </>
    );
}
