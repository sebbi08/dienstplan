import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { todayIso } from '../../shared/domain/dates'
import { createBackup } from '../services/backup'

export default defineServiceHandler(async (event) => {
  // The file holds everything, including contract data and password hashes: Träger only.
  await requireProvider(event)
  const file = join(tmpdir(), `dienstplan-${Date.now()}.db`)
  await createBackup(useSqlite(), file)
  const data = await readFile(file)
  await rm(file)
  setResponseHeaders(event, {
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Disposition': `attachment; filename="dienstplan-${todayIso()}.db"`,
  })
  return data
})
