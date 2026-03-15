import { defineConfig } from "tsup"

export default defineConfig({
    entry: {
        dev: "dev.ts",
    },
    format: ["esm"],
    platform: "node",
    clean: true,
    // Bundle agent's own code, but keep workspace & npm deps external
    noExternal: [],
    external: [
        /^@any-code\//,
        /^sql\.js/,
    ],
})
