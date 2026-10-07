import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
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

/**
 * Runs the pending migrations with foreign keys switched off, as SQLite requires for rebuilding tables and for adding
 * a REFERENCES column with a default to a filled table. Drizzle's migrator wraps everything in one transaction, where
 * the generated `PRAGMA foreign_keys` statements are no-ops, so it has to happen here. Afterwards every foreign key
 * is checked, and the app refuses to start on a violation.
 */
export function migrateDb(db: Db, migrationsFolder: string): void {
  db.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    migrate(db as Parameters<typeof migrate>[0], { migrationsFolder })
    const violations = db.all(sql`PRAGMA foreign_key_check`)
    if (violations.length > 0) throw new Error(`Foreign key violations after migrating: ${JSON.stringify(violations.slice(0, 10))}`)
  }
  finally {
    db.run(sql`PRAGMA foreign_keys = ON`)
  }
}
