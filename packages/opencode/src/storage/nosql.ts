/**
 * NoSqlDb — Simple NoSQL-style CRUD interface for storage.
 *
 * Business code uses this instead of drizzle-orm directly.
 * Implementations can be backed by SQLite, IndexedDB, in-memory Map, etc.
 */

/** Filter conditions for queries */
export type Filter =
  | { op: "eq"; field: string; value: any }
  | { op: "ne"; field: string; value: any }
  | { op: "gt"; field: string; value: any }
  | { op: "gte"; field: string; value: any }
  | { op: "lt"; field: string; value: any }
  | { op: "like"; field: string; value: string }
  | { op: "isNull"; field: string }
  | { op: "in"; field: string; values: any[] }
  | { op: "and"; conditions: Filter[] }
  | { op: "or"; conditions: Filter[] }

export interface FindManyOptions {
  filter?: Filter
  orderBy?: { field: string; direction: "asc" | "desc" }[]
  limit?: number
  /** Select specific fields only */
  select?: string[]
}

export interface NoSqlDb {
  /** Insert one row */
  insert(table: string, row: Record<string, any>): void

  /** Insert or update on primary-key conflict */
  upsert(
    table: string,
    row: Record<string, any>,
    conflictKeys: string[],
    updateFields: Record<string, any>,
  ): void

  /** Find one record matching filter */
  findOne(table: string, filter?: Filter, options?: { select?: string[] }): Record<string, any> | undefined

  /** Find multiple records */
  findMany(table: string, options?: FindManyOptions): Record<string, any>[]

  /** Update records matching filter, return first updated row (or undefined) */
  update(table: string, filter: Filter, set: Record<string, any>): Record<string, any> | undefined

  /** Delete records matching filter */
  remove(table: string, filter: Filter): void

  /** Run operations in a transaction */
  transaction(fn: (tx: NoSqlDb) => void): void
}
