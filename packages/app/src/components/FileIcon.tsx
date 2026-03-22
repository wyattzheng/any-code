import { useMemo } from "react";
import { getIconData, iconToSVG, iconToHTML } from "@iconify/utils";
import iconSet from "./fileIconData.json";

// ── Extension → icon name mapping ───────────────────────────────────────

const EXT_MAP: Record<string, string> = {
    // Web
    ts: "file-type-typescript",
    tsx: "file-type-reactts",
    js: "file-type-js",
    jsx: "file-type-reactjs",
    mjs: "file-type-js",
    cjs: "file-type-js",
    json: "file-type-json",
    html: "file-type-html",
    htm: "file-type-html",
    css: "file-type-css",
    scss: "file-type-scss",
    less: "file-type-less",
    svg: "file-type-svg",
    vue: "file-type-vue",
    svelte: "file-type-svelte",
    astro: "file-type-astro",

    // Data / Config
    yaml: "file-type-yaml",
    yml: "file-type-yaml",
    toml: "file-type-toml",
    xml: "file-type-xml",
    csv: "file-type-json",
    env: "file-type-dotenv",
    ini: "file-type-ini",

    // Backend / Systems
    py: "file-type-python",
    rb: "file-type-ruby",
    go: "file-type-go",
    rs: "file-type-rust",
    java: "file-type-java",
    kt: "file-type-kotlin",
    swift: "file-type-swift",
    c: "file-type-c",
    h: "file-type-c",
    cpp: "file-type-cpp",
    hpp: "file-type-cpp",
    cs: "file-type-csharp",
    php: "file-type-php",
    lua: "file-type-lua",
    dart: "file-type-dart",
    ex: "file-type-elixir",
    exs: "file-type-elixir",
    erl: "file-type-erlang",
    zig: "file-type-zig",
    nim: "file-type-nim",

    // Shell / Scripts
    sh: "file-type-shell",
    bash: "file-type-shell",
    zsh: "file-type-shell",
    fish: "file-type-shell",
    ps1: "file-type-powershell",
    bat: "file-type-bat",

    // Docs
    md: "file-type-markdown",
    mdx: "file-type-mdx",
    txt: "file-type-text",
    pdf: "file-type-text",
    tex: "file-type-tex",
    rst: "file-type-rest",

    // Images
    png: "file-type-image",
    jpg: "file-type-image",
    jpeg: "file-type-image",
    gif: "file-type-image",
    webp: "file-type-image",
    ico: "file-type-image",
    bmp: "file-type-image",

    // Video / Audio
    mp4: "file-type-video",
    webm: "file-type-video",
    mp3: "file-type-audio",
    wav: "file-type-audio",
    ogg: "file-type-audio",

    // Containers / DevOps
    dockerfile: "file-type-docker",

    // DB
    sql: "file-type-sql",
    graphql: "file-type-graphql",
    gql: "file-type-graphql",
    prisma: "file-type-prisma",

    // Misc
    lock: "file-type-json",
    log: "file-type-log",
    wasm: "file-type-wasm",
    zip: "file-type-zip",
    tar: "file-type-zip",
    gz: "file-type-zip",
};

// Special filenames
const NAME_MAP: Record<string, string> = {
    "package.json": "file-type-npm",
    "tsconfig.json": "file-type-tsconfig",
    "vite.config.ts": "file-type-vite",
    "vite.config.js": "file-type-vite",
    ".gitignore": "file-type-git",
    ".gitattributes": "file-type-git",
    ".env": "file-type-dotenv",
    ".env.local": "file-type-dotenv",
    ".env.example": "file-type-dotenv",
    ".eslintrc": "file-type-eslint",
    ".eslintrc.js": "file-type-eslint",
    ".eslintrc.json": "file-type-eslint",
    ".prettierrc": "file-type-prettier",
    "prettier.config.js": "file-type-prettier",
    "dockerfile": "file-type-docker",
    "docker-compose.yml": "file-type-docker",
    "docker-compose.yaml": "file-type-docker",
    "compose.yml": "file-type-docker",
    "compose.yaml": "file-type-docker",
    "makefile": "file-type-shell",
    "license": "file-type-license",
    "readme.md": "file-type-markdown",
    "yarn.lock": "file-type-yarn",
    "pnpm-lock.yaml": "file-type-pnpm",
    "tailwind.config.js": "file-type-tailwind",
    "tailwind.config.ts": "file-type-tailwind",
    "jest.config.js": "file-type-jest",
    "jest.config.ts": "file-type-jest",
    "vitest.config.ts": "file-type-vitest",
    "capacitor.config.ts": "file-type-capacitor",
    "tsup.config.ts": "file-type-tsconfig",
    ".npmrc": "file-type-npm",
};

const FOLDER_MAP: Record<string, string> = {
    src: "folder-type-src",
    lib: "folder-type-library",
    dist: "folder-type-dist",
    build: "folder-type-dist",
    node_modules: "folder-type-node",
    tests: "folder-type-test",
    test: "folder-type-test",
    docs: "folder-type-docs",
    public: "folder-type-public",
    assets: "folder-type-asset",
    images: "folder-type-images",
    components: "folder-type-component",
    pages: "folder-type-view",
    views: "folder-type-view",
    config: "folder-type-config",
    scripts: "folder-type-script",
    styles: "folder-type-css",
    utils: "folder-type-src",
    hooks: "folder-type-hook",
    api: "folder-type-api",
    packages: "folder-type-package",
    ".git": "folder-type-git",
    ".github": "folder-type-github",
    ".vscode": "folder-type-vscode",
};

function getIconName(filename: string, isDir: boolean): string {
    const lower = filename.toLowerCase();

    if (isDir) {
        return FOLDER_MAP[lower] || "default-folder";
    }

    // Check exact filename first
    if (NAME_MAP[lower]) return NAME_MAP[lower];

    // Check extension
    const dot = filename.lastIndexOf(".");
    if (dot > 0) {
        const ext = filename.slice(dot + 1).toLowerCase();
        if (EXT_MAP[ext]) return EXT_MAP[ext];
    }

    return "default-file";
}

// ── SVG cache ───────────────────────────────────────────────────────────

const svgCache = new Map<string, string>();

function getSvgHtml(iconName: string): string {
    if (svgCache.has(iconName)) return svgCache.get(iconName)!;

    const data = getIconData(iconSet as any, iconName);
    if (!data) {
        // fallback
        const fallback = getIconData(iconSet as any, "default-file");
        if (!fallback) return "";
        const svg = iconToSVG(fallback);
        const html = iconToHTML(svg.body, svg.attributes);
        svgCache.set(iconName, html);
        return html;
    }

    const svg = iconToSVG(data);
    const html = iconToHTML(svg.body, svg.attributes);
    svgCache.set(iconName, html);
    return html;
}

// ── Component ───────────────────────────────────────────────────────────

interface FileIconProps {
    filename: string;
    isDir?: boolean;
    size?: number;
}

export function FileIcon({ filename, isDir = false, size = 16 }: FileIconProps) {
    const html = useMemo(() => {
        const name = getIconName(filename, isDir);
        return getSvgHtml(name);
    }, [filename, isDir]);

    return (
        <span
            className="vsc-file-icon"
            style={{
                width: size,
                height: size,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                verticalAlign: "middle",
            }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
