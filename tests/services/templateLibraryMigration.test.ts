import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'

const MIGRATIONS = 'server/db/migrations'

/** A database as the version before 0133 left it (Bögen and PDF templates with categories of their own). */
function databaseBefore0133() {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.filter(entry => entry.tag.slice(0, 4) <= '0132')
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  const { db, sqlite } = createDb(':memory:')
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder })
  rmSync(folder, { recursive: true, force: true })
  return { db, sqlite }
}

describe('0133_one_template_library', () => {
  it('merges the Bögen categories into the PDF ones by name, keeps stricter ones apart, loses nothing and keeps the order', () => {
    const { db, sqlite } = databaseBefore0133()
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      DELETE FROM form_templates; DELETE FROM form_template_categories; DELETE FROM print_templates; DELETE FROM template_categories;
      INSERT INTO template_categories (id, facility_id, parent_id, name, sort_order, visibility) VALUES
        (10, 1, NULL, 'Eltern', 0, 'all'), (11, 1, NULL, 'Team', 1, 'managers'), (12, 1, NULL, 'Gesundheit', 2, 'all'),
        (13, 1, 12, 'Hygiene', 0, 'all'), (14, 1, 12, 'Intern', 1, 'managers'), (15, 1, NULL, 'Träger', 3, 'provider'),
        (30, 2, NULL, 'Kinder', 0, 'all');
      INSERT INTO form_template_categories (id, facility_id, parent_id, name, sort_order) VALUES
        (20, 1, NULL, 'Kinder', 0), (21, 1, NULL, 'team', 1), (22, 1, NULL, 'gesundheit', 2), (27, 1, NULL, 'Träger', 3),
        (25, 1, 20, 'Krippe', 0), (23, 1, 22, 'hygiene', 0), (24, 1, 22, 'Intern', 1), (26, 1, 22, 'Neu', 2),
        (40, 2, NULL, 'Kinder', 0);
      INSERT INTO form_templates (id, facility_id, category_id, kind, name, sort_order, content, created_at, updated_at) VALUES
        (1, 1, 20, 'child', 'Beobachtung', 0, '{"sections":[]}', 'c', 'u'), (2, 1, 25, 'child', 'Krippenbogen', 0, '{"sections":[]}', 'c', 'u'),
        (3, 1, 21, 'team', 'Teamsitzung', 0, '{"sections":[]}', 'c', 'u'), (4, 1, 22, 'child', 'Gesundheitsbogen', 3, '{"sections":[]}', 'c', 'u'),
        (5, 1, 23, 'child', 'Hygienebogen', 0, '{"sections":[]}', 'c', 'u'), (6, 1, 24, 'staff', 'Internbogen', 0, '{"sections":[]}', 'c', 'u'),
        (7, 1, 26, 'child', 'Neuer Bogen', 0, '{"sections":[]}', 'c', 'u'), (8, 1, NULL, 'info', 'Ohne', 2, '{"sections":[]}', 'c', 'u'),
        (9, 2, 40, 'child', 'Krippe Kinder', 1, '{"sections":[]}', 'c', 'u'), (10, 1, 27, 'staff', 'Trägerbogen', 0, '{"sections":[]}', 'c', 'u');
      INSERT INTO print_templates (id, facility_id, title, category_id, mime_type, size, data, uploaded_at, updated_at) VALUES
        (1, 1, 'Hygieneplan', 13, 'application/pdf', 4, x'25504446', 'x', 'x');
      INSERT INTO print_template_order (facility_id, template_id, sort_order) VALUES (1, 1, 0);
      INSERT INTO forms (facility_id, template_id, kind, title, content, created_at, updated_at) VALUES (1, 3, 'team', 'Sitzung', '{"sections":[]}', 'c', 'u');
    `)
    migrateDb(db, MIGRATIONS)

    const categories = sqlite.prepare(`SELECT c.id, c.facility_id, p.name AS parent, c.name, c.sort_order, c.visibility FROM template_categories c
      LEFT JOIN template_categories p ON p.id = c.parent_id ORDER BY c.facility_id, c.parent_id IS NOT NULL, p.sort_order, c.sort_order`).all() as
      { id: number; facility_id: number; parent: string | null; name: string; sort_order: number; visibility: string }[]
    const shape = categories.map(({ id: _, ...rest }) => rest)
    expect(shape).toEqual([
      // The PDF categories first, as they were; then the Bögen-only ones in their order; a stricter twin stays apart.
      { facility_id: 1, parent: null, name: 'Eltern', sort_order: 0, visibility: 'all' },
      { facility_id: 1, parent: null, name: 'Team', sort_order: 1, visibility: 'managers' },
      { facility_id: 1, parent: null, name: 'Gesundheit', sort_order: 2, visibility: 'all' },
      { facility_id: 1, parent: null, name: 'Träger', sort_order: 3, visibility: 'provider' },
      { facility_id: 1, parent: null, name: 'Kinder', sort_order: 4, visibility: 'all' },
      { facility_id: 1, parent: null, name: 'team (Bögen)', sort_order: 5, visibility: 'all' },
      { facility_id: 1, parent: null, name: 'Träger (Bögen)', sort_order: 6, visibility: 'all' },
      { facility_id: 1, parent: 'Gesundheit', name: 'Hygiene', sort_order: 0, visibility: 'all' },
      { facility_id: 1, parent: 'Gesundheit', name: 'Intern', sort_order: 1, visibility: 'managers' },
      { facility_id: 1, parent: 'Gesundheit', name: 'Intern (Bögen)', sort_order: 2, visibility: 'all' },
      { facility_id: 1, parent: 'Gesundheit', name: 'Neu', sort_order: 3, visibility: 'all' },
      { facility_id: 1, parent: 'Kinder', name: 'Krippe', sort_order: 0, visibility: 'all' },
      { facility_id: 2, parent: null, name: 'Kinder', sort_order: 0, visibility: 'all' },
    ])
    const idOf = (facility: number, parent: string | null, name: string) =>
      categories.find(row => row.facility_id === facility && row.parent === parent && row.name === name)!.id
    // Every template kept, in the category its own one became; the places move behind the PDF templates (+1 000 000).
    expect(sqlite.prepare('SELECT id, category_id, sort_order FROM form_templates ORDER BY id').all()).toEqual([
      { id: 1, category_id: idOf(1, null, 'Kinder'), sort_order: 1_000_000 },
      { id: 2, category_id: idOf(1, 'Kinder', 'Krippe'), sort_order: 1_000_000 },
      { id: 3, category_id: idOf(1, null, 'team (Bögen)'), sort_order: 1_000_000 },
      { id: 4, category_id: 12, sort_order: 1_000_003 },
      { id: 5, category_id: 13, sort_order: 1_000_000 },
      { id: 6, category_id: idOf(1, 'Gesundheit', 'Intern (Bögen)'), sort_order: 1_000_000 },
      { id: 7, category_id: idOf(1, 'Gesundheit', 'Neu'), sort_order: 1_000_000 },
      { id: 8, category_id: null, sort_order: 1_000_002 },
      { id: 9, category_id: 30, sort_order: 1_000_001 },
      { id: 10, category_id: idOf(1, null, 'Träger (Bögen)'), sort_order: 1_000_000 },
    ])
    expect(sqlite.prepare('SELECT template_id FROM forms').all()).toEqual([{ template_id: 3 }])
    expect(sqlite.prepare('SELECT id, category_id FROM print_templates').all()).toEqual([{ id: 1, category_id: 13 }])
    expect(sqlite.prepare('SELECT * FROM print_template_order').all()).toEqual([{ facility_id: 1, template_id: 1, sort_order: 0 }])
    const tables = (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(row => row.name)
    expect(tables).not.toContain('form_template_categories')
    expect(tables).not.toContain('__form_category_map')
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // The templates now point at the shared categories: deleting one leaves its templates without a category.
    sqlite.exec(`DELETE FROM template_categories WHERE id = ${idOf(1, 'Gesundheit', 'Neu')}`)
    expect(sqlite.prepare('SELECT category_id FROM form_templates WHERE id = 7').get()).toEqual({ category_id: null })
    expect(() => sqlite.exec(`UPDATE form_templates SET category_id = 9999 WHERE id = 1`)).toThrow(/FOREIGN KEY/)
  })

  it('takes a further name when „‹Name› (Bögen)“ is taken too', () => {
    const { db, sqlite } = databaseBefore0133()
    sqlite.exec(`
      DELETE FROM form_templates; DELETE FROM form_template_categories; DELETE FROM print_templates; DELETE FROM template_categories;
      INSERT INTO template_categories (id, facility_id, parent_id, name, sort_order, visibility) VALUES (10, 1, NULL, 'Team', 0, 'managers');
      INSERT INTO form_template_categories (id, facility_id, parent_id, name, sort_order) VALUES (20, 1, NULL, 'Team', 0), (21, 1, NULL, 'Team (Bögen)', 1);
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT name, sort_order, visibility FROM template_categories ORDER BY sort_order').all()).toEqual([
      { name: 'Team', sort_order: 0, visibility: 'managers' },
      { name: 'Team (Bögen 20)', sort_order: 1, visibility: 'all' },
      { name: 'Team (Bögen)', sort_order: 2, visibility: 'all' },
    ])
  })
})
