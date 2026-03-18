import { MonitorIcon } from "./Icons";
import "./PreviewTab.css";

export function PreviewTab() {
    // TODO: previewUrl will come from agent web project route mapping
    const previewUrl: string | null = null;

    if (!previewUrl) {
        return (
            <div className="preview-tab">
                <div className="preview-empty">
                    <MonitorIcon size={36} />
                    <p>通过对话让 AI 生成界面，结果将展示在这里</p>
                </div>
            </div>
        );
    }

    return (
        <div className="preview-tab">
            <iframe className="preview-iframe" src={previewUrl} title="Preview" />
        </div>
    );
}
