/**
 * SqliteNoSqlDb — Translates NoSqlDb operations to raw SQL queries.
 *
 * Shared adapter for both sql.js and better-sqlite3 backends.
 * The backends only need to provide a minimal `RawSqliteDb` handle.
 */
import type { NoSqlDb, Filter, FindManyOptions } from "./nosql"

/**
 * Minimal raw SQLite handle — both sql.js and better-sqlite3
 * must implement this thin wrapper.
 */
export interface RawSqliteDb {
  /** Run a non-returning statement (INSERT, UPDATE, DELETE) */
  run(sql: string, params?: any[]): void
  /** Get one row */
  get(sql: string, params?: any[]): Record<string, any> | undefined
  /** Get all rows */
  all(sql: string, params?: any[]): Record<string, any>[]
  /** Run in transaction */
  transaction(fn: () => void): void
}

export class SqliteNoSqlDb implements NoSqlDb {
  constructor(private raw: RawSqliteDb) {}

  insert(table: string, row: Record<string, any>): void {
    const cols = Object.keys(row)
    const placeholders = cols.map(() => "?").join(", ")
    const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`
    this.raw.run(sql, cols.map(c => serialize(row[c])))
  }

  upsert(
    table: string,
    row: Record<string, any>,
    conflictKeys: string[],
    updateFields: Record<string, any>,
  ): void {
    const cols = Object.keys(row)
    const placeholders = cols.map(() => "?").join(", ")
    const conflict = conflictKeys.map(k => `"${k}"`).join(", ")
    const updates = Object.keys(updateFields)
      .map(k => `"${k}" = ?`)
      .join(", ")
    const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`
    const params = [
      ...cols.map(c => serialize(row[c])),
      ...Object.keys(updateFields).map(k => serialize(updateFields[k])),
    ]
    this.raw.run(sql, params)
  }

  findOne(
    table: string,
    filter?: Filter,
    options?: { select?: string[] },
  ): Record<string, any> | undefined {
    const fields = options?.select?.map(f => `"${f}"`).join(", ") ?? "*"
    const { clause, params } = filter ? buildWhere(filter) : { clause: "", params: [] }
    const where = clause ? ` WHERE ${clause}` : ""
    const sql = `SELECT ${fields} FROM "${table}"${where} LIMIT 1`
    const row = this.raw.get(sql, params)
    return row ? deserializeRow(row) : undefined
  }

  findMany(table: string, options?: FindManyOptions): Record<string, any>[] {
    const fields = options?.select?.map(f => `"${f}"`).join(", ") ?? "*"
    const { clause, params } = options?.filter ? buildWhere(options.filter) : { clause: "", params: [] }
    const where = clause ? ` WHERE ${clause}` : ""

    let orderClause = ""
    if (options?.orderBy?.length) {
      const parts = options.orderBy.map(
        o => `"${o.field}" ${o.direction === "desc" ? "DESC" : "ASC"}`,
      )
      orderClause = ` ORDER BY ${parts.join(", ")}`
    }

    const limitClause = options?.limit != null ? ` LIMIT ${options.limit}` : ""
    const sql = `SELECT ${fields} FROM "${table}"${where}${orderClause}${limitClause}`
    return this.raw.all(sql, params).map(deserializeRow)
  }

  update(
    table: string,
    filter: Filter,
    set: Record<string, any>,
  ): Record<string, any> | undefined {
    const setCols = Object.keys(set)
    const setClause = setCols.map(k => `"${k}" = ?`).join(", ")
    const { clause, params } = buildWhere(filter)
    const sql = `UPDATE "${table}" SET ${setClause} WHERE ${clause} RETURNING *`
    const setParams = setCols.map(k => serialize(set[k]))
    const row = this.raw.get(sql, [...setParams, ...params])
    return row ? deserializeRow(row) : undefined
  }

  remove(table: string, filter: Filter): void {
    const { clause, params } = buildWhere(filter)
    this.raw.run(`DELETE FROM "${table}" WHERE ${clause}`, params)
  }

  transaction(fn: (tx: NoSqlDb) => void): void {
    this.raw.transaction(() => {
      fn(this)
    })
  }
}

// ── Helpers ──

function buildWhere(filter: Filter): { clause: string; params: any[] } {
  switch (filter.op) {
    case "eq":
      return { clause: `"${filter.field}" = ?`, params: [serialize(filter.value)] }
    case "ne":
      return { clause: `"${filter.field}" != ?`, params: [serialize(filter.value)] }
    case "gt":
      return { clause: `"${filter.field}" > ?`, params: [serialize(filter.value)] }
    case "gte":
      return { clause: `"${filter.field}" >= ?`, params: [serialize(filter.value)] }
    case "lt":
      return { clause: `"${filter.field}" < ?`, params: [serialize(filter.value)] }
    case "like":
      return { clause: `"${filter.field}" LIKE ?`, params: [filter.value] }
    case "isNull":
      return { clause: `"${filter.field}" IS NULL`, params: [] }
    case "in": {
      const placeholders = filter.values.map(() => "?").join(", ")
      return { clause: `"${filter.field}" IN (${placeholders})`, params: filter.values.map(serialize) }
    }
    case "and": {
      const parts = filter.conditions.map(buildWhere)
      return {
        clause: parts.map(p => `(${p.clause})`).join(" AND "),
        params: parts.flatMap(p => p.params),
      }
    }
    case "or": {
      const parts = filter.conditions.map(buildWhere)
      return {
        clause: parts.map(p => `(${p.clause})`).join(" OR "),
        params: parts.flatMap(p => p.params),
      }
    }
  }
}

/** Serialize JS values for SQLite storage (objects → JSON strings) */
function serialize(value: any): any {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === "object" && !(value instanceof Buffer) && !(value instanceof Uint8Array)) {
    return JSON.stringify(value)
  }
  return value
}

/** Deserialize a row — parse JSON columns back to objects */
function deserializeRow(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
      try {
        result[key] = JSON.parse(value)
      } catch {
        result[key] = value
      }
    } else {
      result[key] = value
    }
  }
  return result
}
