import type Database from 'better-sqlite3'
import { createDb, type Db } from '../db/client'

let connection: { db: Db; sqlite: Database.Database } | null = null

function open() {
  if (!connection) connection = createDb(process.env.DATABASE_PATH || '.data/app.db')
  return connection
}

export function useDb(): Db {
  return open().db
}

export function useSqlite(): Database.Database {
  return open().sqlite
}
