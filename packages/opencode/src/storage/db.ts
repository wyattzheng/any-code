import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"

import { Log } from "../util/log"
import { NamedError } from "@/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import * as schema from "./schema"
import { Flag } from "../util/flag"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  type Schema = typeof schema
  export type Client = ReturnType<typeof drizzle<Schema>>
  export type Transaction = Parameters<Parameters<Client["transaction"]>[0]>[0]

  type Journal = { sql: string; timestamp: number; name: string }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Returns the migration entries (bundled or from disk).
   */
  export function getMigrations(): Journal {
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (Flag.OPENCODE_SKIP_MIGRATIONS) {
      for (const item of entries) {
        item.sql = "select 1;"
      }
    }
    return entries
  }

  /**
   * Database client context — no module-level mutable state.
   * The client is provided via `Database.provide()` which sets up
   * an AsyncLocalStorage scope. All `Database.use()` calls within
   * that scope can access the client.
   */
  const clientCtx = Context.create<{ client: Client }>("database-client")

  /**
   * Provide a database client for the duration of the callback.
   * All Database.use() / Database.transaction() calls within scope
   * will use this client.
   */
  export function provide<R>(client: Client, fn: () => R): R {
    return clientCtx.provide({ client }, fn)
  }

  /**
   * Get the current database client from context.
   */
  function getClient(): Client {
    return clientCtx.use().client
  }

  export type TxOrDb = Transaction | Client

  const txCtx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database-tx")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(txCtx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const client = getClient()
        const effects: (() => void | Promise<void>)[] = []
        const result = txCtx.provide({ effects, tx: client }, () => callback(client))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      txCtx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(txCtx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const client = getClient()
        const effects: (() => void | Promise<void>)[] = []
        const result = (client.transaction as any)((tx: TxOrDb) => {
          return txCtx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
