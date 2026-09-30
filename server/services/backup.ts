import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { IsoDate } from '../../shared/domain/types'

const BACKUP_NAME = /^app-\d{4}-\d{2}-\d{2}\.db$/

export async function createBackup(sqlite: Database.Database, file: string): Promise<void> {
  await sqlite.backup(file)
}

/** Writes `app-<today>.db` once per day into `dir` and deletes all but the newest `keep` backups. */
export async function runDailyBackup(
  sqlite: Database.Database, dir: string, today: IsoDate, keep = 14,
): Promise<string | null> {
  await mkdir(dir, { recursive: true })
  const name = `app-${today}.db`
  if ((await readdir(dir)).includes(name)) return null
  const file = join(dir, name)
  const partial = `${file}.tmp`
  try {
    await createBackup(sqlite, partial)
    await rename(partial, file)
  }
  catch (error) {
    await rm(partial, { force: true })
    throw error
  }
  const backups = (await readdir(dir)).filter(entry => BACKUP_NAME.test(entry)).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) await rm(join(dir, old))
  return file
}
