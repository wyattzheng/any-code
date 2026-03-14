import type { TabId } from "../App";
import { MonitorIcon, FolderIcon, DiffIcon } from "./Icons";
import "./TabBar.css";

interface TabBarProps {
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
    return (
        <nav className="tab-bar">
            {/* 动态 Tab 区域：未来从 agent tablist JSON 读取 */}

            <div className="tab-spacer" />

            <button
                className={`tab-item ${activeTab === "preview" ? "active" : ""}`}
                onClick={() => onTabChange("preview")}
            >
                <span className="tab-icon"><MonitorIcon /></span>
                <span className="tab-label">预览</span>
            </button>

            <button
                className={`tab-item ${activeTab === "files" ? "active" : ""}`}
                onClick={() => onTabChange("files")}
            >
                <span className="tab-icon"><FolderIcon /></span>
                <span className="tab-label">文件</span>
            </button>

            <button
                className={`tab-item ${activeTab === "changes" ? "active" : ""}`}
                onClick={() => onTabChange("changes")}
            >
                <span className="tab-icon"><DiffIcon /></span>
                <span className="tab-label">变更</span>
            </button>
        </nav>
    );
}

