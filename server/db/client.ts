import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

/** Accepts both the root database and a transaction. */
export type Db = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>

export function createDb(filename: string): { db: Db; sqlite: Database.Database } {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
  const sqlite = new Database(filename)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return { db: drizzle({ client: sqlite, schema }), sqlite }
}

export function migrateDb(db: Db, migrationsFolder: string): void {
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder })
}
