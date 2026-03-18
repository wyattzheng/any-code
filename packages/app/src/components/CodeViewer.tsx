import { useEffect, useState, useMemo, memo } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import "./CodeViewer.css";

// Shared singleton highlighter — lazily created, reused across all instances
let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
    if (!highlighterPromise) {
        highlighterPromise = createHighlighter({
            themes: ["github-dark"],
            langs: ["text"],
        });
    }
    return highlighterPromise;
}

/** Map file extension to shiki language id */
function extToLang(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
        ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
        json: "json", md: "markdown", css: "css", scss: "scss",
        html: "html", xml: "xml", svg: "xml",
        py: "python", rb: "ruby", rs: "rust", go: "go",
        java: "java", kt: "kotlin", swift: "swift",
        c: "c", cpp: "cpp", h: "c", hpp: "cpp",
        sh: "bash", bash: "bash", zsh: "bash",
        sql: "sql", yaml: "yaml", yml: "yaml", toml: "toml",
        dockerfile: "dockerfile", makefile: "makefile",
        vue: "vue", svelte: "svelte",
        graphql: "graphql", gql: "graphql",
        lua: "lua", php: "php", r: "r",
    };
    const name = filePath.split("/").pop()?.toLowerCase() ?? "";
    if (name === "dockerfile") return "dockerfile";
    if (name === "makefile" || name === "gnumakefile") return "makefile";
    return map[ext] || "text";
}

/**
 * Inject line numbers and diff markers directly into Shiki's HTML output.
 * This avoids DOM manipulation via useEffect, which gets wiped on re-render.
 */
function injectLineInfo(html: string, addedLines?: Set<number>, removedLines?: Set<number>): string {
    let lineNum = 0;
    return html.replace(/<span class="line"/g, () => {
        lineNum++;
        const classes = ["line"];
        if (addedLines?.has(lineNum)) classes.push("diff-added");
        if (removedLines?.has(lineNum)) classes.push("diff-removed");
        return `<span class="${classes.join(" ")}" data-line="${lineNum}"`;
    });
}

export interface CodeViewerProps {
    code: string;
    filePath: string;
    /** Set of line numbers (1-indexed) to highlight as added */
    addedLines?: Set<number>;
    /** Set of line numbers (1-indexed) to highlight as removed */
    removedLines?: Set<number>;
}

export const CodeViewer = memo(function CodeViewer({ code, filePath, addedLines, removedLines }: CodeViewerProps) {
    const [rawHtml, setRawHtml] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const hl = await getHighlighter();
                const lang = extToLang(filePath);

                // Dynamically load language if not yet loaded
                if (lang !== "text" && !loadedLangs.has(lang)) {
                    try {
                        await hl.loadLanguage(lang as any);
                        loadedLangs.add(lang);
                    } catch {
                        // Language not available — fall back to text
                    }
                }

                const effectiveLang = loadedLangs.has(lang) ? lang : "text";

                const result = hl.codeToHtml(code, {
                    lang: effectiveLang,
                    theme: "github-dark",
                });

                if (!cancelled) setRawHtml(result);
            } catch {
                if (!cancelled) setError(true);
            }
        })();

        return () => { cancelled = true; };
    }, [code, filePath]);

    // Derive final HTML with line numbers + diff markers baked in
    const finalHtml = useMemo(() => {
        if (!rawHtml) return null;
        return injectLineInfo(rawHtml, addedLines, removedLines);
    }, [rawHtml, addedLines, removedLines]);

    if (error) {
        return <pre className="code-viewer-fallback">{code}</pre>;
    }

    if (!finalHtml) {
        return <div className="code-viewer-loading">...</div>;
    }

    return (
        <div
            className="code-viewer"
            dangerouslySetInnerHTML={{ __html: finalHtml }}
        />
    );
});
