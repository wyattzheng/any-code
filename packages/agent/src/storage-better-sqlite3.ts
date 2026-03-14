/**
 * BetterSqliteStorage — file-based SQLite backend using better-sqlite3.
 *
 * Used in production — wraps the native better-sqlite3 driver.
 * All imports are dynamic to avoid module resolution issues in test environments.
 */
import type { StorageProvider, Migration } from "./storage"

export class BetterSqliteStorage implements StorageProvider {
    private sqlite: any = null
    private dataPath: string

    constructor(dataPath: string) {
        this.dataPath = dataPath
    }

    private async getDbPath(): Promise<string> {
        const path = await import("path")
        const { Installation } = await import("@any-code/opencode/util/installation")
        const { Flag } = await import("@any-code/opencode/util/flag")

        const channel = Installation.CHANNEL
        if (["latest", "beta"].includes(channel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
            return path.join(this.dataPath, "opencode.db")
        const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
        return path.join(this.dataPath, `opencode-${safe}.db`)
    }

    async connect(migrations: Migration[]) {
        const path = await import("path")
        const BetterSqlite3 = (await import("better-sqlite3")).default
        const { drizzle } = await import("drizzle-orm/better-sqlite3")
        const schema = await import("@any-code/opencode/storage/schema")

        const dbPath = await this.getDbPath()
        this.sqlite = new BetterSqlite3(dbPath)

        this.sqlite.pragma("journal_mode = WAL")
        this.sqlite.pragma("synchronous = NORMAL")
        this.sqlite.pragma("busy_timeout = 5000")
        this.sqlite.pragma("cache_size = -64000")
        this.sqlite.pragma("foreign_keys = ON")
        this.sqlite.pragma("wal_checkpoint(PASSIVE)")

        // Apply migrations
        this.applyMigrations(migrations)

        return drizzle({ client: this.sqlite, schema })
    }

    private applyMigrations(entries: Migration[]) {
        if (!this.sqlite) throw new Error("BetterSqliteStorage: db not initialized")

        this.sqlite.exec(`
            CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at INTEGER
            )
        `)

        const applied = new Set(
            this.sqlite
                .prepare(`SELECT hash FROM "__drizzle_migrations"`)
                .all()
                .map((row: any) => row.hash as string),
        )

        for (const entry of entries) {
            const hash = entry.name
            if (applied.has(hash)) continue
            this.sqlite.exec(entry.sql)
            this.sqlite
                .prepare(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`)
                .run(hash, entry.timestamp)
        }
    }

    close() {
        if (this.sqlite) {
            this.sqlite.close()
            this.sqlite = null
        }
    }
}
