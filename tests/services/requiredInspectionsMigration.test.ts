import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'

const MIGRATIONS = 'server/db/migrations'
const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
const TAG = journal.entries.find(entry => entry.tag.endsWith('_required_inspections'))!.tag
const CLEANUP_TAG = journal.entries.find(entry => entry.tag.endsWith('_inspection_cleanup'))!.tag

/** A database as the version before `tag` (default: before „nur Einsicht vermerken“) left it. */
function databaseBefore(tag = TAG) {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const entries = journal.entries.slice(0, journal.entries.findIndex(entry => entry.tag === tag))
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
    sqlite.exec(`INSERT INTO required_inspections (employee_id, type_id, certificate_date, no_relevant_entry, recorded_at) VALUES (1, ${efz}, '2026-11-01', 1, 'x')`)
    expect(() => sqlite.exec(`INSERT INTO required_inspections (employee_id, type_id, certificate_date, no_relevant_entry, recorded_at) VALUES (1, ${efz}, '2026-11-02', 1, 'x')`))
      .toThrow(/UNIQUE/)
    sqlite.exec(`DELETE FROM required_document_types WHERE id = ${efz}`)
    expect(sqlite.prepare('SELECT count(*) AS n FROM required_inspections').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})

describe(CLEANUP_TAG, () => {
  it('takes the certificate date from the day of inspection, marks the files kept for a type „nur Einsicht“, adds the audit log', () => {
    const { db, sqlite } = databaseBefore(CLEANUP_TAG)
    sqlite.exec(`INSERT INTO employees (id, name, short_name, facility_id) VALUES (1, 'Anna', 'An', 1)`)
    const typeId = (name: string) => (sqlite.prepare('SELECT id FROM required_document_types WHERE facility_id = 1 AND name = ?').get(name) as { id: number }).id
    const efz = typeId('Erweitertes Führungszeugnis')
    const masern = typeId('Masernnachweis')
    sqlite.exec(`INSERT INTO required_inspections (employee_id, type_id, inspected_on, no_relevant_entry, recorded_at) VALUES (1, ${efz}, '2026-11-01', 0, 'x')`)
    const insert = sqlite.prepare(`INSERT INTO employee_documents (id, employee_id, folder, title, mime_type, size, data, uploaded_at, required_type_id)
      VALUES (?, 1, 'required', 'D', 'application/pdf', 4, x'25504446', '2026-10-01T08:00:00.000Z', ?)`)
    insert.run(1, efz)
    insert.run(2, masern)
    insert.run(3, null)

    migrateDb(db, MIGRATIONS)

    // Nothing is lost: the record keeps its day of inspection, which also becomes the certificate's date.
    expect(sqlite.prepare('SELECT employee_id, type_id, certificate_date, inspected_on, no_relevant_entry FROM required_inspections').all())
      .toEqual([{ employee_id: 1, type_id: efz, certificate_date: '2026-11-01', inspected_on: '2026-11-01', no_relevant_entry: 0 }])
    // Only the file of the type „nur Einsicht“ is marked; the link stays.
    expect(sqlite.prepare('SELECT id, required_type_id, inspection_cleanup, inspection_type_id FROM employee_documents ORDER BY id').all()).toEqual([
      { id: 1, required_type_id: efz, inspection_cleanup: 1, inspection_type_id: efz },
      { id: 2, required_type_id: masern, inspection_cleanup: 0, inspection_type_id: null },
      { id: 3, required_type_id: null, inspection_cleanup: 0, inspection_type_id: null },
    ])
    expect(sqlite.prepare('SELECT count(*) AS n FROM required_inspection_log').get()).toEqual({ n: 0 })
    // „eingesehen am“ is optional now; the certificate's date is not.
    expect(() => sqlite.exec(`INSERT INTO required_inspections (employee_id, type_id, certificate_date, no_relevant_entry, recorded_at) VALUES (1, ${masern}, '2026-10-01', 1, 'x')`))
      .not.toThrow()
    expect(() => sqlite.exec(`INSERT INTO required_inspections (employee_id, type_id, inspected_on, no_relevant_entry, recorded_at) VALUES (1, ${typeId('Arbeitsvertrag')}, '2026-10-01', 1, 'x')`))
      .toThrow(/NOT NULL/)
    // A deleted type leaves the marker and clears only its id (ON DELETE SET NULL); the person takes the log along.
    const fks = (table: string) => (sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as { from: string; table: string; on_delete: string }[])
      .map(({ from, table: target, on_delete }) => ({ from, table: target, on_delete })).sort((a, b) => a.from.localeCompare(b.from))
    expect(fks('employee_documents').filter(fk => fk.from === 'inspection_type_id')).toEqual([{ from: 'inspection_type_id', table: 'required_document_types', on_delete: 'SET NULL' }])
    expect(fks('required_inspection_log')).toEqual([
      { from: 'employee_id', table: 'employees', on_delete: 'CASCADE' }, { from: 'type_id', table: 'required_document_types', on_delete: 'SET NULL' },
    ])
    sqlite.exec(`DELETE FROM required_document_types WHERE id = ${efz}`)
    expect(sqlite.prepare('SELECT inspection_cleanup, inspection_type_id, required_type_id FROM employee_documents WHERE id = 1').get())
      .toEqual({ inspection_cleanup: 1, inspection_type_id: null, required_type_id: null })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})

const CERTIFICATE_TAG = journal.entries.find(entry => entry.tag.endsWith('_inspection_certificate'))!.tag

describe(CERTIFICATE_TAG, () => {
  it('flags only the example „Erweitertes Führungszeugnis“ (any spelling) „§ 72a“ and fills what lines and markers keep of their type', () => {
    const { db, sqlite } = databaseBefore(CERTIFICATE_TAG)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO required_document_types (id, facility_id, name, folder, sort_order, mode) VALUES
        (101, 2, ' ERWEITERTES FÜHRUNGSZEUGNIS ', 'application', 0, 'inspection'), (102, 2, 'Führungszeugnis Ehrenamt', 'required', 1, 'inspection'),
        (103, 2, 'Masern-Einsicht', 'required', 2, 'inspection');
      INSERT INTO employees (id, name, short_name, facility_id) VALUES (1, 'Anna', 'An', 2);
      INSERT INTO required_inspection_log (id, employee_id, type_id, action, actor, at) VALUES
        (1, 1, 101, 'recorded', 'Lea', 'x'), (2, 1, 103, 'recorded', 'Lea', 'x'), (3, 1, NULL, 'deleted', 'Lea', 'x');
      INSERT INTO employee_documents (id, employee_id, folder, title, mime_type, size, data, uploaded_at, inspection_cleanup, inspection_type_id) VALUES
        (1, 1, 'required', 'FZ', 'application/pdf', 4, x'25504446', 'z', 1, 101), (2, 1, 'required', 'M', 'application/pdf', 4, x'25504446', 'z', 1, 103),
        (3, 1, 'required', 'alt', 'application/pdf', 4, x'25504446', 'z', 1, NULL), (4, 1, 'required', 'frei', 'application/pdf', 4, x'25504446', 'z', 0, NULL);
    `)

    migrateDb(db, MIGRATIONS)

    // Own types – even one named „Führungszeugnis …“ – stay unflagged (the Träger decides in the settings).
    expect(sqlite.prepare('SELECT facility_id, name FROM required_document_types WHERE certificate = 1 ORDER BY facility_id, id').all())
      .toEqual([{ facility_id: 1, name: 'Erweitertes Führungszeugnis' }, { facility_id: 2, name: ' ERWEITERTES FÜHRUNGSZEUGNIS ' }])
    expect(sqlite.prepare('SELECT id, type_id, type_name, folder, certificate FROM required_inspection_log ORDER BY id').all()).toEqual([
      { id: 1, type_id: 101, type_name: ' ERWEITERTES FÜHRUNGSZEUGNIS ', folder: 'application', certificate: 1 },
      { id: 2, type_id: 103, type_name: 'Masern-Einsicht', folder: 'required', certificate: 0 },
      // Already without its type: counts as the Führungszeugnis (the shorter retention).
      { id: 3, type_id: null, type_name: '', folder: null, certificate: 1 },
    ])
    expect(sqlite.prepare('SELECT id, inspection_certificate FROM employee_documents ORDER BY id').all()).toEqual([
      { id: 1, inspection_certificate: 1 }, { id: 2, inspection_certificate: 0 }, { id: 3, inspection_certificate: 1 }, { id: 4, inspection_certificate: 0 },
    ])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
