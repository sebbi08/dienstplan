import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'
import { employeeRequiredDocuments } from '../../server/services/requiredDocuments'
import type { PermissionKey } from '../../shared/domain/permissions'

const MIGRATIONS = 'server/db/migrations'
const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
const TAG = journal.entries.find(entry => entry.tag.endsWith('_required_documents_folder'))!.tag

/** A database as the version before the folder „Pflichtdokumente“ left it. */
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
  it('moves every Pflichtdokument but the Arbeitsvertrag and own types in Vertrag, Gehalt and Maßnahmen, with the linked documents', () => {
    const { db, sqlite } = databaseBefore()
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO required_document_types (id, facility_id, name, folder, sort_order) VALUES
        (101, 1, 'Gehaltsabtretung', 'salary', 10), (102, 1, 'Nebentätigkeit', 'contract', 11), (103, 1, 'Abmahnung gelesen', 'measures', 12),
        (104, 1, 'Hygieneschulung', 'correspondence', 13), (105, 1, 'Lebenslauf', 'application', 14),
        (106, 2, 'ARBEITSVERTRAG', 'application', 0), (107, 2, 'Fortbildung Sprache', 'qualifications', 1),
        (108, 2, 'SCHWEIGEPFLICHTERKLÄRUNG', 'contract', 2), (109, 2, ' Verpflichtung auf den DATENSCHUTZ ', 'contract', 3);
      INSERT INTO employees (id, name, short_name, facility_id) VALUES (1, 'Anna', 'An', 1);
    `)
    const typeOf = (name: string, facilityId = 1) =>
      (sqlite.prepare('SELECT id FROM required_document_types WHERE facility_id = ? AND name = ?').get(facilityId, name) as { id: number }).id
    const addDocument = sqlite.prepare(`INSERT INTO employee_documents (id, employee_id, folder, title, document_date, mime_type, size, data, uploaded_at, required_type_id)
      VALUES (?, 1, ?, ?, '2026-10-01', 'application/pdf', 4, x'25504446', '2026-10-01T08:00:00.000Z', ?)`)
    addDocument.run(1, 'contract', 'Vertrag', typeOf('Arbeitsvertrag'))
    addDocument.run(2, 'application', 'Führungszeugnis', typeOf('Erweitertes Führungszeugnis'))
    addDocument.run(3, 'qualifications', 'Erste Hilfe', typeOf('Erste-Hilfe-Nachweis'))
    addDocument.run(4, 'contract', 'Datenschutz', typeOf('Verpflichtung auf den Datenschutz'))
    addDocument.run(5, 'salary', 'Abtretung', 101)
    addDocument.run(6, 'contract', 'Nebentätigkeit', 102)
    addDocument.run(7, 'application', 'Lebenslauf ohne Zuordnung', null)
    // A stale link from another folder counted nowhere; it stays where it is.
    addDocument.run(8, 'correspondence', 'Alter Link', typeOf('Erweitertes Führungszeugnis'))
    addDocument.run(9, 'measures', 'Abmahnung', 103)
    addDocument.run(10, 'correspondence', 'Hygiene', 104)
    addDocument.run(11, 'contract', 'Schweigepflicht', typeOf('Schweigepflichterklärung'))
    const addRequest = sqlite.prepare(`INSERT INTO sign_requests (id, facility_id, created_at, title, source_kind, source_document_id, file_size, file_sha256,
      source_folder, target_folder, required_type_id) VALUES (?, 1, '2026-10-01T08:00:00.000Z', ?, ?, ?, 4, 'x', ?, ?, ?)`)
    addRequest.run(1, 'Datenschutz unterschreiben', 'document', 4, 'contract', 'contract', typeOf('Verpflichtung auf den Datenschutz'))
    addRequest.run(2, 'Vertrag unterschreiben', 'template', null, null, 'contract', typeOf('Arbeitsvertrag'))
    addRequest.run(3, 'Lebenslauf bestätigen', 'document', 7, 'application', 'correspondence', null)
    addRequest.run(4, 'Nebentätigkeit', 'document', 6, 'contract', 'contract', 102)
    const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    const before = { types: count('required_document_types'), documents: count('employee_documents'), requests: count('sign_requests') }

    migrateDb(db, MIGRATIONS)

    const types = (facilityId: number) => sqlite.prepare('SELECT name, folder FROM required_document_types WHERE facility_id = ? ORDER BY sort_order, id').all(facilityId)
    expect(types(1)).toEqual([
      { name: 'Arbeitsvertrag', folder: 'contract' },
      { name: 'Erweitertes Führungszeugnis', folder: 'required' },
      { name: 'Masernnachweis', folder: 'required' },
      { name: 'Belehrung Infektionsschutz', folder: 'required' },
      { name: 'Verpflichtung auf den Datenschutz', folder: 'required' },
      { name: 'Erste-Hilfe-Nachweis', folder: 'required' },
      { name: 'Schweigepflichterklärung', folder: 'required' },
      { name: 'Gehaltsabtretung', folder: 'salary' },
      { name: 'Nebentätigkeit', folder: 'contract' },
      { name: 'Abmahnung gelesen', folder: 'measures' },
      { name: 'Hygieneschulung', folder: 'required' },
      { name: 'Lebenslauf', folder: 'required' },
    ])
    // Another facility (added after the examples): the examples in other spelling are still the examples.
    expect(types(2)).toEqual([
      { name: 'ARBEITSVERTRAG', folder: 'application' },
      { name: 'Fortbildung Sprache', folder: 'required' },
      { name: 'SCHWEIGEPFLICHTERKLÄRUNG', folder: 'required' },
      { name: ' Verpflichtung auf den DATENSCHUTZ ', folder: 'required' },
    ])
    expect(sqlite.prepare('SELECT id, folder, required_type_id IS NOT NULL AS linked FROM employee_documents ORDER BY id').all()).toEqual([
      { id: 1, folder: 'contract', linked: 1 }, { id: 2, folder: 'required', linked: 1 }, { id: 3, folder: 'required', linked: 1 },
      { id: 4, folder: 'required', linked: 1 }, { id: 5, folder: 'salary', linked: 1 }, { id: 6, folder: 'contract', linked: 1 },
      { id: 7, folder: 'application', linked: 0 }, { id: 8, folder: 'correspondence', linked: 1 }, { id: 9, folder: 'measures', linked: 1 },
      { id: 10, folder: 'required', linked: 1 }, { id: 11, folder: 'required', linked: 1 },
    ])
    expect(sqlite.prepare('SELECT id, source_folder, target_folder FROM sign_requests ORDER BY id').all()).toEqual([
      { id: 1, source_folder: 'required', target_folder: 'required' },
      { id: 2, source_folder: null, target_folder: 'contract' },
      { id: 3, source_folder: 'application', target_folder: 'correspondence' },
      { id: 4, source_folder: 'contract', target_folder: 'contract' },
    ])
    expect({ types: count('required_document_types'), documents: count('employee_documents'), requests: count('sign_requests') }).toEqual(before)
    expect(sqlite.prepare(`SELECT name FROM sqlite_temp_master WHERE name = 'moved_required_types'`).all()).toEqual([])

    // Nothing flipped to „fehlt“: the moved documents still count for their types.
    const traeger = { id: 1, role: 'provider' as const, permissions: new Set<PermissionKey>(['employees.view', 'employees.docs.contract', 'employees.docs.required']) }
    const states = Object.fromEntries(employeeRequiredDocuments(db, traeger, 1, 1, '2026-11-26').map(row => [row.name, row.state]))
    expect(states).toMatchObject({
      'Arbeitsvertrag': 'present', 'Erweitertes Führungszeugnis': 'present', 'Erste-Hilfe-Nachweis': 'present',
      'Verpflichtung auf den Datenschutz': 'present', 'Schweigepflichterklärung': 'present', 'Hygieneschulung': 'present',
      'Nebentätigkeit': 'present', 'Masernnachweis': 'missing',
    })
  })
})
