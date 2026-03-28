import { useState, useCallback, useRef } from "react";
import { FileIcon } from "./FileIcon";
import { CodeViewer } from "./CodeViewer";
import type { FileContext } from "../App";

interface FileContentPanelProps {
    selectedFile: string | null;
    fileContent: string | null;
    fileLoading: boolean;
    addedLines?: Set<number>;
    scrollToLine?: number | null;
    onFileContext?: (ctx: FileContext | null) => void;
    emptyText?: string;
    contentBodyRef?: React.RefObject<HTMLDivElement | null>;
}

export function FileContentPanel({
    selectedFile,
    fileContent,
    fileLoading,
    addedLines,
    scrollToLine,
    onFileContext,
    emptyText = "选择文件查看内容",
    contentBodyRef: externalRef,
}: FileContentPanelProps) {
    const [wordWrap, setWordWrap] = useState(true);
    const [menuOpen, setMenuOpen] = useState(false);
    const internalRef = useRef<HTMLDivElement>(null);
    const bodyRef = externalRef ?? internalRef;

    const handleSelectionChange = useCallback((lines: number[]) => {
        if (!selectedFile) return;
        if (lines.length === 0) {
            onFileContext?.(null);
        } else {
            onFileContext?.({ file: selectedFile, lines });
        }
    }, [selectedFile, onFileContext]);

    if (!selectedFile) {
        return (
            <div className="file-empty">
                <p>{emptyText}</p>
            </div>
        );
    }

    return (
        <>
            <div className="file-content-header">
                <FileIcon filename={selectedFile.split('/').pop() || selectedFile} />
                <span className="file-content-path">{selectedFile}</span>
                <div className="file-content-menu">
                    <button className="file-content-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="4" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="20" r="1.5" fill="currentColor" />
                        </svg>
                    </button>
                    {menuOpen && (
                        <div className="file-content-dropdown">
                            <div className="file-content-dropdown-item" onClick={() => { setWordWrap(!wordWrap); setMenuOpen(false); }}>
                                <input type="checkbox" checked={wordWrap} readOnly />
                                <span>自动换行</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <div className="file-content-body" ref={bodyRef}>
                {fileLoading ? (
                    <div className="file-content-loading">加载中…</div>
                ) : fileContent !== null ? (
                    <CodeViewer
                        code={fileContent}
                        filePath={selectedFile}
                        addedLines={addedLines}
                        onSelectionChange={handleSelectionChange}
                        scrollToLine={scrollToLine}
                        wordWrap={wordWrap}
                    />
                ) : (
                    <div className="file-content-error">无法读取文件</div>
                )}
            </div>
        </>
    );
}
