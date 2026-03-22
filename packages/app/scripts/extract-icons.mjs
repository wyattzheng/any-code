/**
 * Build-time script: extracts only the icons we need from @iconify-json/vscode-icons
 * and writes a slim JSON file for runtime use.
 *
 * Run: node scripts/extract-icons.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fullSet = JSON.parse(
    readFileSync(join(__dirname, "../node_modules/@iconify-json/vscode-icons/icons.json"), "utf-8")
);

// All icon names we reference in FileIcon.tsx
const NEEDED = new Set([
    // Extensions → file types
    "file-type-typescript", "file-type-reactts", "file-type-js", "file-type-reactjs",
    "file-type-json", "file-type-html", "file-type-css", "file-type-scss", "file-type-less",
    "file-type-svg", "file-type-vue", "file-type-svelte", "file-type-astro",
    "file-type-yaml", "file-type-toml", "file-type-xml", "file-type-csv",
    "file-type-dotenv", "file-type-ini", "file-type-properties",
    "file-type-python", "file-type-ruby", "file-type-go", "file-type-rust",
    "file-type-java", "file-type-kotlin", "file-type-swift", "file-type-c", "file-type-cpp",
    "file-type-csharp", "file-type-php", "file-type-lua", "file-type-dart",
    "file-type-elixir", "file-type-erlang", "file-type-zig", "file-type-nim",
    "file-type-shell", "file-type-powershell", "file-type-bat",
    "file-type-markdown", "file-type-mdx", "file-type-text", "file-type-pdf",
    "file-type-tex", "file-type-rest",
    "file-type-image", "file-type-video", "file-type-audio",
    "file-type-docker", "file-type-sql", "file-type-graphql", "file-type-prisma",
    "file-type-lock", "file-type-log", "file-type-wasm", "file-type-zip",
    // Special filenames
    "file-type-npm", "file-type-tsconfig", "file-type-vite", "file-type-git",
    "file-type-eslint", "file-type-prettier", "file-type-makefile", "file-type-license",
    "file-type-yarn", "file-type-pnpm", "file-type-tailwind",
    "file-type-jest", "file-type-vitest", "file-type-capacitor",
    // Folders
    "folder-type-src", "folder-type-library", "folder-type-dist", "folder-type-node",
    "folder-type-test", "folder-type-docs", "folder-type-public", "folder-type-asset",
    "folder-type-images", "folder-type-component", "folder-type-view", "folder-type-config",
    "folder-type-script", "folder-type-css", "folder-type-utils", "folder-type-hook",
    "folder-type-api", "folder-type-package", "folder-type-git", "folder-type-github",
    "folder-type-vscode",
    // Defaults
    "default-file", "default-folder",
]);

const slim = {
    prefix: fullSet.prefix,
    icons: {},
    width: fullSet.width,
    height: fullSet.height,
};

let found = 0;
for (const name of NEEDED) {
    if (fullSet.icons[name]) {
        slim.icons[name] = fullSet.icons[name];
        found++;
    } else {
        console.warn(`⚠  Icon "${name}" not found in icon set`);
    }
}

const outPath = join(__dirname, "../src/components/fileIconData.json");
writeFileSync(outPath, JSON.stringify(slim));

const fullSize = JSON.stringify(fullSet).length;
const slimSize = JSON.stringify(slim).length;
console.log(`✅  Extracted ${found}/${NEEDED.size} icons`);
console.log(`   Full: ${(fullSize / 1024).toFixed(0)} KB → Slim: ${(slimSize / 1024).toFixed(0)} KB (${((slimSize / fullSize) * 100).toFixed(1)}%)`);
