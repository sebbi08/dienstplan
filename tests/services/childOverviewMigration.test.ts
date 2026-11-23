import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { overviewColumns } from '../../app/utils/childrenOverview'
import { createDb, migrateDb } from '../../server/db/client'
import { childrenOverview } from '../../server/services/children'
import { addUser, asChildViewer } from '../helpers/fixtures'
import { insertOverviewSample, SAMPLE_NOW, SAMPLE_TODAY } from '../helpers/overviewSample'

const MIGRATIONS = 'server/db/migrations'

/** A database as the version before 0111 left it (the fixed consent columns and sheets). */
function databaseBefore0111() {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.filter(entry => entry.tag.slice(0, 4) <= '0110')
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  const { db, sqlite } = createDb(':memory:')
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder })
  rmSync(folder, { recursive: true, force: true })
  return { db, sqlite }
}

describe('the children overview after the migration to the facility\'s own questions and tabs', () => {
  it('renders exactly the tabs, columns and cells of the fixed sheets before, in every facility', () => {
    // Rendered with the fixed sheets (OVERVIEW_SHEETS) and the fixed consent columns from the same sample, before 0111.
    const before = JSON.parse(readFileSync('tests/fixtures/children-overview-before.json', 'utf8')) as Record<string, unknown>
    const { db, sqlite } = databaseBefore0111()
    insertOverviewSample(sqlite)
    migrateDb(db, MIGRATIONS)
    const after: Record<string, unknown> = {}
    for (const facility of [1, 2, 3]) {
      const viewer = asChildViewer(addUser(db, `leitung${facility}`, 'admin', null, facility))
      const dto = childrenOverview(db, viewer, SAMPLE_TODAY, SAMPLE_NOW)
      after[facility] = {
        children: dto.children.map(row => `${row.lastName}, ${row.firstName}`),
        sheets: dto.sheets.map(sheet => ({
          name: sheet.name,
          columns: overviewColumns(sheet.columns, dto.children, { questions: dto.questions, groups: dto.groups }).map(column => ({
            label: column.label, title: column.title, wide: column.wide ?? false, cells: dto.children.map(row => column.cell(row)),
          })),
        })),
      }
    }
    expect(after).toEqual(before)
    // The sample really covers yes, no and open in the consent columns.
    const cells = JSON.stringify(before)
    for (const value of ['"value":true', '"value":false', '"value":null']) expect(cells.replaceAll(/\s/g, '')).toContain(value)
  })
})
