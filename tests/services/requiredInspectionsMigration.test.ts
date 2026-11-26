import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'

const MIGRATIONS = 'server/db/migrations'
const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
const TAG = journal.entries.find(entry => entry.tag.endsWith('_required_inspections'))!.tag

/** A database as the version before „nur Einsicht vermerken“ left it. */
function databaseBefore() {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const entries = journal.entries.slice(0, journal.entries.findIndex(entry => entry.tag === TAG))
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  const { db, sqlite } = createDb(':memory:')
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder })
  rmSync(folder, { recursive: true, force: true })
  return { db, sqlite }
}

describe(TAG, () => {
  it('switches only the example „Erweitertes Führungszeugnis“ (any spelling, any folder) to „nur Einsicht“; files stay', () => {
    const { db, sqlite } = databaseBefore()
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO required_document_types (id, facility_id, name, folder, sort_order) VALUES
        (101, 2, ' ERWEITERTES FÜHRUNGSZEUGNIS ', 'application', 0), (102, 2, 'Führungszeugnis (alt)', 'required', 1),
        (103, 2, 'Erweitertes Führungszeugnis Ehrenamt', 'required', 2);
      INSERT INTO employees (id, name, short_name, facility_id) VALUES (1, 'Anna', 'An', 1);
    `)
    const efz = (sqlite.prepare(`SELECT id FROM required_document_types WHERE facility_id = 1 AND name = 'Erweitertes Führungszeugnis'`).get() as { id: number }).id
    sqlite.prepare(`INSERT INTO employee_documents (id, employee_id, folder, title, mime_type, size, data, uploaded_at, required_type_id)
      VALUES (1, 1, 'required', 'FZ', 'application/pdf', 4, x'25504446', '2026-10-01T08:00:00.000Z', ?)`).run(efz)

    migrateDb(db, MIGRATIONS)

    expect(sqlite.prepare(`SELECT name, mode FROM required_document_types ORDER BY facility_id, sort_order, id`).all()).toEqual([
      { name: 'Arbeitsvertrag', mode: 'file' },
      { name: 'Erweitertes Führungszeugnis', mode: 'inspection' },
      { name: 'Masernnachweis', mode: 'file' },
      { name: 'Belehrung Infektionsschutz', mode: 'file' },
      { name: 'Verpflichtung auf den Datenschutz', mode: 'file' },
      { name: 'Erste-Hilfe-Nachweis', mode: 'file' },
      { name: 'Schweigepflichterklärung', mode: 'file' },
      { name: ' ERWEITERTES FÜHRUNGSZEUGNIS ', mode: 'inspection' },
      { name: 'Führungszeugnis (alt)', mode: 'file' },
      { name: 'Erweitertes Führungszeugnis Ehrenamt', mode: 'file' },
    ])
    // Nothing is deleted: the old file stays linked (listed for cleaning up), no inspection is invented.
    expect(sqlite.prepare('SELECT id, required_type_id FROM employee_documents').all()).toEqual([{ id: 1, required_type_id: efz }])
    expect(sqlite.prepare('SELECT count(*) AS n FROM required_inspections').get()).toEqual({ n: 0 })
    // One record per person and type; it goes with the person and with the type.
    sqlite.exec(`INSERT INTO required_inspections (employee_id, type_id, inspected_on, no_relevant_entry, recorded_at) VALUES (1, ${efz}, '2026-11-01', 1, 'x')`)
    expect(() => sqlite.exec(`INSERT INTO required_inspections (employee_id, type_id, inspected_on, no_relevant_entry, recorded_at) VALUES (1, ${efz}, '2026-11-02', 1, 'x')`))
      .toThrow(/UNIQUE/)
    sqlite.exec(`DELETE FROM required_document_types WHERE id = ${efz}`)
    expect(sqlite.prepare('SELECT count(*) AS n FROM required_inspections').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
