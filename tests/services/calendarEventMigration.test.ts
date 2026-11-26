import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'

const MIGRATIONS = 'server/db/migrations'
/** The migration's tag, whatever its number (…_calendar_event_audience). */
const TAG = (JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }).entries
  .find(entry => entry.tag.endsWith('_calendar_event_audience'))!.tag

/** A database as the version before TAG left it (appointments with the yes/no „Auch für Mitarbeitende sichtbar?“). */
function databaseBefore() {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.filter(entry => entry.tag < TAG)
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  const { db, sqlite } = createDb(':memory:')
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder })
  rmSync(folder, { recursive: true, force: true })
  return { db, sqlite }
}

describe(TAG, () => {
  it('turns „Auch für Mitarbeitende sichtbar?“ into „Alle“ (ja) or „Nur Leitung und Träger“ (nein), so nobody sees more', () => {
    const { db, sqlite } = databaseBefore()
    const insert = sqlite.prepare('insert into calendar_events (facility_id, date, start, end, title, visible_to_staff) values (1, ?, ?, ?, ?, ?)')
    insert.run('2026-10-14', 1140, 1260, 'Elternabend', 1)
    insert.run('2026-10-15', null, null, 'Personalgespräch', 0)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('select title, date, end_date, start, end, visibility from calendar_events order by id').all()).toEqual([
      { title: 'Elternabend', date: '2026-10-14', end_date: null, start: 1140, end: 1260, visibility: 'all' },
      { title: 'Personalgespräch', date: '2026-10-15', end_date: null, start: null, end: null, visibility: 'leaders' },
    ])
    const columns = (sqlite.prepare('pragma table_info(calendar_events)').all() as { name: string }[]).map(column => column.name)
    expect(columns).not.toContain('visible_to_staff')
  })

  it('turns an appointment whose list loses its last group or person into „Nur Leitung und Träger“', () => {
    const { db, sqlite } = databaseBefore()
    migrateDb(db, MIGRATIONS)
    sqlite.exec(`
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären'), (2, 1, 'Igel');
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1), (2, 'Ben', 1);
      INSERT INTO calendar_events (id, facility_id, date, title, visibility) VALUES
        (1, 1, '2026-10-14', 'Gruppen', 'groups'), (2, 1, '2026-10-15', 'Personen', 'employees');
      INSERT INTO calendar_event_groups (event_id, group_id) VALUES (1, 1), (1, 2);
      INSERT INTO calendar_event_employees (event_id, employee_id) VALUES (2, 1), (2, 2);
    `)
    const visibility = (id: number) => (sqlite.prepare('select visibility from calendar_events where id = ?').get(id) as { visibility: string }).visibility
    sqlite.exec('DELETE FROM groups WHERE id = 1')
    expect(visibility(1)).toBe('groups')
    sqlite.exec('DELETE FROM groups WHERE id = 2')
    expect(visibility(1)).toBe('leaders')
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(visibility(2)).toBe('employees')
    sqlite.exec('DELETE FROM employees WHERE id = 2')
    expect(visibility(2)).toBe('leaders')
  })
})
