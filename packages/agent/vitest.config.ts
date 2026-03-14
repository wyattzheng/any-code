import { defineConfig } from "vitest/config"
import path from "path"
import tsconfigPaths from "vite-tsconfig-paths"

const opencodeSrc = path.resolve(__dirname, "../opencode/src")

export default defineConfig({
    plugins: [
        tsconfigPaths({
            projects: [path.resolve(__dirname, "../opencode/tsconfig.json")],
        }),
    ],
    test: {
        testTimeout: 60_000,
        hookTimeout: 60_000,
        pool: "forks",
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        include: ["tests/**/*.test.ts"],
        setupFiles: ["tests/setup.ts"],
        server: {
            deps: {
                // Externalize fastify and its deps that require Node >= 20
                // These are transitively pulled in by hono-openapi but not needed for agent tests
                external: [
                    "fastify",
                    /fastify/,
                ],
            },
        },
    },
    resolve: {
        alias: {
            // Resolve @any-code/opencode subpath imports
            "@any-code/opencode/plugin": path.join(opencodeSrc, "plugin/index.ts"),
            "@any-code/opencode/project/instance": path.join(opencodeSrc, "project/instance.ts"),
            "@any-code/opencode/session/index": path.join(opencodeSrc, "session/index.ts"),
            "@any-code/opencode/session/message-v2": path.join(opencodeSrc, "session/message-v2.ts"),
            "@any-code/opencode/session/prompt": path.join(opencodeSrc, "session/prompt.ts"),
            "@any-code/opencode/bus/index": path.join(opencodeSrc, "bus/index.ts"),
            "@any-code/opencode/tool/registry": path.join(opencodeSrc, "tool/registry.ts"),
            "@any-code/opencode/tool/tool": path.join(opencodeSrc, "tool/tool.ts"),
            "@any-code/opencode/provider/provider": path.join(opencodeSrc, "provider/provider.ts"),
        },
    },
})
