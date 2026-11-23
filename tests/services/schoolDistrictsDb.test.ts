import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'

const MIGRATIONS = join(process.cwd(), 'server', 'db', 'migrations')
/** The migration of the school district lists (tests/services/db.test.ts tests the others the same way). */
const TAG = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')).entries
  .map((entry: { tag: string }) => entry.tag).find((tag: string) => tag.endsWith('_school_districts')) as string
const NUMBER = TAG.slice(0, 4)

/** A copy of the migrations whose number `keep` takes. */
function migrationsThrough(keep: (number: string) => boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.filter(entry => keep(entry.tag.slice(0, 4)))
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  return folder
}

const count = (sqlite: Database.Database, table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('migration of the school district lists', () => {
  it(`${TAG} adds the lists, their rows and districts: one own list per facility and one for all, gone with their owners`, () => {
    const before = migrationsThrough(number => number < NUMBER)
    const { db, sqlite } = createDb(':memory:')
    migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: before })
    rmSync(before, { recursive: true, force: true })
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO users (id, username, password_hash, role, facility_id) VALUES (1, 'traeger', 'x', 'provider', 1);
      INSERT INTO contact_categories (id, facility_id, name) VALUES (90, 1, 'Grundschulen');
      INSERT INTO contacts (id, facility_id, category_id, organisation, updated_at) VALUES (1, 1, 90, 'Südstadtschule', 'a');
    `)
    const through = migrationsThrough(number => number <= NUMBER)
    try {
      migrateDb(db, through)
    }
    finally {
      rmSync(through, { recursive: true, force: true })
    }
    for (const table of ['school_district_lists', 'school_district_rows', 'school_districts']) expect(count(sqlite, table), table).toBe(0)

    sqlite.exec(`
      INSERT INTO school_district_lists (id, facility_id, name, created_at, created_by, updated_at, updated_by) VALUES
        (1, 1, 'Stadt', 'a', 1, 'a', 1), (2, NULL, 'Träger', 'a', 1, 'a', 1), (3, 2, 'Krippe', 'a', NULL, 'a', NULL);
      INSERT INTO school_district_rows (list_id, street, street_key, from_no, to_no, side, district) VALUES
        (1, 'Ahornweg', 'ahornweg', 2, 14, 'even', '04'), (2, 'Ahornweg', 'ahornweg', NULL, NULL, 'all', '01'), (3, 'Weg', 'weg', 1, 1, 'odd', '01');
      INSERT INTO school_districts (list_id, code, name, contact_id) VALUES (1, '04', 'Südstadtschule', 1), (2, '01', '', NULL), (3, '01', '', NULL);
    `)
    expect(sqlite.prepare('SELECT as_of, name FROM school_district_lists WHERE id = 1').get()).toEqual({ as_of: '', name: 'Stadt' })
    expect(sqlite.prepare('SELECT from_suffix, to_suffix, flags, note FROM school_district_rows WHERE list_id = 1').get())
      .toEqual({ from_suffix: '', to_suffix: '', flags: '', note: '' })
    // One own list per facility and one for all facilities; one entry per code and list.
    expect(() => sqlite.exec(`INSERT INTO school_district_lists (facility_id, created_at, updated_at) VALUES (1, 'b', 'b')`)).toThrow(/UNIQUE/)
    expect(() => sqlite.exec(`INSERT INTO school_district_lists (facility_id, created_at, updated_at) VALUES (NULL, 'b', 'b')`)).toThrow(/UNIQUE/)
    expect(() => sqlite.exec(`INSERT INTO school_districts (list_id, code) VALUES (1, '04')`)).toThrow(/UNIQUE/)
    const fks = (table: string) => sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all()
      .map((fk) => { const { table: to, from, on_delete } = fk as Record<string, string>; return { to, from, on_delete } })
    expect(fks('school_district_lists')).toEqual(expect.arrayContaining([
      { to: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { to: 'users', from: 'created_by', on_delete: 'SET NULL' },
      { to: 'users', from: 'updated_by', on_delete: 'SET NULL' },
    ]))
    expect(fks('school_district_rows')).toEqual([{ to: 'school_district_lists', from: 'list_id', on_delete: 'CASCADE' }])
    expect(fks('school_districts')).toEqual(expect.arrayContaining([
      { to: 'school_district_lists', from: 'list_id', on_delete: 'CASCADE' },
      { to: 'contacts', from: 'contact_id', on_delete: 'SET NULL' },
    ]))
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // Rows are looked up by list and street key.
    expect(sqlite.prepare(`EXPLAIN QUERY PLAN SELECT * FROM school_district_rows WHERE list_id = 1 AND street_key = 'ahornweg'`).all())
      .toEqual([expect.objectContaining({ detail: expect.stringContaining('school_district_rows_list_street') })])

    // A deleted school contact leaves the district without it; a deleted user leaves the list without a name.
    sqlite.exec('DELETE FROM contacts WHERE id = 1')
    expect(sqlite.prepare('SELECT contact_id FROM school_districts WHERE list_id = 1').get()).toEqual({ contact_id: null })
    sqlite.exec('DELETE FROM users WHERE id = 1')
    expect(sqlite.prepare('SELECT created_by, updated_by FROM school_district_lists WHERE id = 1').get()).toEqual({ created_by: null, updated_by: null })
    // A list goes with its facility, rows and districts with their list; the Träger's list stays.
    sqlite.exec('DELETE FROM facilities WHERE id = 2')
    expect(sqlite.prepare('SELECT id FROM school_district_lists ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }])
    sqlite.exec('DELETE FROM school_district_lists WHERE id = 1')
    expect(sqlite.prepare('SELECT list_id FROM school_district_rows').all()).toEqual([{ list_id: 2 }])
    expect(sqlite.prepare('SELECT list_id FROM school_districts').all()).toEqual([{ list_id: 2 }])
  })
})
