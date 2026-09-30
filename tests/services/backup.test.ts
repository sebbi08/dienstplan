import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'
import { runDailyBackup } from '../../server/services/backup'

describe('runDailyBackup', () => {
  it('creates one backup per day and keeps the newest 14', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dienstplan-backup-'))
    const { db, sqlite } = createDb(join(dir, 'source', 'app.db'))
    migrateDb(db, 'server/db/migrations')
    const backups = join(dir, 'backups')

    const first = await runDailyBackup(sqlite, backups, '2026-10-05')
    expect(first).toBe(join(backups, 'app-2026-10-05.db'))
    expect(await runDailyBackup(sqlite, backups, '2026-10-05')).toBeNull()
    expect(readdirSync(backups).filter(name => name.endsWith('.tmp'))).toEqual([])

    for (let day = 1; day <= 20; day++) writeFileSync(join(backups, `app-2026-09-${String(day).padStart(2, '0')}.db`), '')
    await runDailyBackup(sqlite, backups, '2026-10-06')
    const files = readdirSync(backups).sort()
    expect(files).toHaveLength(14)
    expect(files.at(-1)).toBe('app-2026-10-06.db')
    expect(files[0]).toBe('app-2026-09-09.db')
    sqlite.close()
  })
})
