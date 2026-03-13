import "./FileBrowser.css";

export function FileBrowser() {
    return (
        <div className="file-browser">
            <div className="file-browser-sidebar">
                <div className="panel-header">📁 文件</div>
                <div className="file-tree">
                    <div className="file-tree-item folder">
                        <span className="file-icon">📂</span>
                        <span className="file-name">src/</span>
                    </div>
                    <div className="file-tree-item file indent">
                        <span className="file-icon">📄</span>
                        <span className="file-name">main.tsx</span>
                    </div>
                    <div className="file-tree-item file indent">
                        <span className="file-icon">📄</span>
                        <span className="file-name">App.tsx</span>
                    </div>
                    <div className="file-tree-item file">
                        <span className="file-icon">📄</span>
                        <span className="file-name">package.json</span>
                    </div>
                </div>
            </div>
            <div className="file-browser-content">
                <div className="panel-header">main.tsx</div>
                <pre className="file-content">
                    <code>{`// 选择左侧文件查看内容`}</code>
                </pre>
            </div>
        </div>
    );
}
