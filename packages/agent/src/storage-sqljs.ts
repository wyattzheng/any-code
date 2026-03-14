/**
 * SqlJsStorage — in-memory SQLite backend using sql.js (WASM).
 *
 * Used for tests — no filesystem needed.
 * Provides a drizzle-orm compatible client via drizzle-orm/sql-js.
 */
import type { StorageProvider, Migration } from "./storage"

export class SqlJsStorage implements StorageProvider {
    private db: any = null

    async connect(migrations: Migration[]) {
        // Dynamic imports for sql.js (WASM) and drizzle adapter
        const initSqlJs = (await import("sql.js")).default
        const SQL = await initSqlJs()
        this.db = new SQL.Database()

        // Apply migrations
        this.applyMigrations(migrations)

        // Create drizzle client using sql-js adapter
        const schema = await import("@any-code/opencode/storage/schema")
        // Import drizzle sql-js adapter - resolve from opencode's deps
        const drizzleSqlJs = await import("drizzle-orm/sql-js")
        return drizzleSqlJs.drizzle(this.db, { schema })
    }

    private applyMigrations(entries: Migration[]) {
        if (!this.db) throw new Error("SqlJsStorage: db not initialized")

        // Create migration tracking table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at INTEGER
            )
        `)

        // Get already applied migrations
        const applied = new Set<string>()
        const rows = this.db.exec(`SELECT hash FROM "__drizzle_migrations"`)
        if (rows.length > 0) {
            for (const row of rows[0].values) {
                applied.add(row[0] as string)
            }
        }

        // Apply pending migrations
        for (const entry of entries) {
            const hash = entry.name
            if (applied.has(hash)) continue
            this.db.run(entry.sql)
            this.db.run(
                `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
                [hash, entry.timestamp]
            )
        }
    }

    close() {
        if (this.db) {
            this.db.close()
            this.db = null
        }
    }
}
