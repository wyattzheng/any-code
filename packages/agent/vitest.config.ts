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
            // Resolve @any-code/opencode to source for tests
            "@any-code/opencode": path.join(opencodeSrc, "index.ts"),
            // drizzle-orm/sql-js adapter — resolve from opencode's pnpm store
            "drizzle-orm/sql-js": path.resolve(__dirname, "../../node_modules/.pnpm/drizzle-orm@1.0.0-beta.16-ea816b6_@opentelemetry+api@1.9.0_@types+better-sqlite3@7.6.13_0f21266a0de314c39cfb891f27e2ae25/node_modules/drizzle-orm/sql-js/index.js"),
        },
    },
})
