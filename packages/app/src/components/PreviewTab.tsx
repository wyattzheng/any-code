import "./PreviewTab.css";

export function PreviewTab() {
    // TODO: previewUrl will come from agent web project route mapping
    const previewUrl: string | null = null;

    if (!previewUrl) {
        return (
            <div className="preview-tab">
                <div className="preview-placeholder">
                    <span className="preview-placeholder-icon">👁</span>
                    <p className="preview-placeholder-text">等待 AI 填充预览界面...</p>
                    <p className="preview-placeholder-hint">AI 生成界面后将在此处展示</p>
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
