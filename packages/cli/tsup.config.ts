import { defineConfig } from "tsup";
import { cpSync } from "fs";
import { dirname, resolve } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const appRoot = dirname(require.resolve("@any-code/app/package.json"));
const appDist = resolve(appRoot, "dist");

export default defineConfig({
    entry: {
        bin: "src/bin.ts",
    },
    format: ["esm"],
    clean: true,
    banner: {
        js: "#!/usr/bin/env node",
    },
    external: ["@lydell/node-pty", "sql.js", "ws"],
    onSuccess: async () => {
        cpSync(appDist, resolve("dist/app"), { recursive: true });
    },
});
