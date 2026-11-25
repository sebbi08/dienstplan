import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'

const MIGRATIONS = 'server/db/migrations'

/** A database as the version before 0130 left it (contacts with the yes/no „auch für Mitarbeitende“). */
function databaseBefore0130() {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.filter(entry => entry.tag.slice(0, 4) <= '0129')
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  const { db, sqlite } = createDb(':memory:')
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder })
  rmSync(folder, { recursive: true, force: true })
  return { db, sqlite }
}

describe('0130_contact_category_visibility', () => {
  it('turns „auch für Mitarbeitende“ into „Wer sieht ihn?“ and gives every category „Alle“, so nobody sees more or less', () => {
    const { db, sqlite } = databaseBefore0130()
    const facility = (sqlite.prepare('select id from facilities order by id limit 1').get() as { id: number }).id
    const category = (sqlite.prepare('select id from contact_categories where facility_id = ? order by sort_order limit 1').get(facility) as { id: number }).id
    const insert = sqlite.prepare(`insert into contacts (facility_id, category_id, category_name, organisation, visible_to_staff, updated_at)
      values (?, ?, ?, ?, ?, '2026-11-01T00:00:00.000Z')`)
    insert.run(facility, category, null, 'Für alle', 1)
    insert.run(facility, category, null, 'Nur Leitung', 0)
    insert.run(null, null, 'Schulen', 'Vom Träger, für alle', 1)
    insert.run(null, null, 'Schulen', 'Vom Träger, nur Leitung', 0)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('select organisation, visibility from contacts order by id').all()).toEqual([
      { organisation: 'Für alle', visibility: 'all' },
      { organisation: 'Nur Leitung', visibility: 'managers' },
      { organisation: 'Vom Träger, für alle', visibility: 'all' },
      { organisation: 'Vom Träger, nur Leitung', visibility: 'managers' },
    ])
    const columns = (sqlite.prepare('pragma table_info(contacts)').all() as { name: string }[]).map(column => column.name)
    expect(columns).toContain('visibility')
    expect(columns).not.toContain('visible_to_staff')
    const categories = sqlite.prepare('select distinct visibility from contact_categories').all()
    expect(categories).toEqual([{ visibility: 'all' }])
  })
})
