/**
 * StorageProvider — abstraction over the database backend.
 *
 * Provides a drizzle-compatible SQLite client for the Database module.
 * Implementations handle database creation, migration, and lifecycle.
 */

export interface Migration {
    sql: string
    timestamp: number
    name: string
}

export interface StorageProvider {
    /**
     * Initialize the database, apply migrations, and return
     * a drizzle-compatible client for queries.
     *
     * The returned client must be compatible with drizzle-orm's
     * BaseSQLiteDatabase<'sync', void, Schema> interface.
     */
    connect(migrations: Migration[]): Promise<any>

    /**
     * Close the database connection and release resources.
     */
    close(): void
}
