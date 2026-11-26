import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb, type Db } from '../../server/db/client'
import { accountRights } from '../../server/services/permissions'
import type { Role } from '../../shared/types/api'
import { addUser } from '../helpers/fixtures'

const MIGRATIONS = 'server/db/migrations'
const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
const TAG = journal.entries.find(entry => entry.tag.endsWith('_required_documents_rights'))!.tag

/** A database as the version before the switch „Dokumente Pflichtdokumente“ left it. */
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

/** Afterwards everyone sees the folder „Pflichtdokumente“ exactly if they saw Qualifikationen or Bewerbung. */
function expectNobodyLosesOrGains(db: Db, people: { id: number; role: Role }[]) {
  for (const person of people) {
    const rights = accountRights(db, { ...person, facilityId: 1 }).permissions
    expect(rights.has('employees.docs.required'), `${person.role} ${person.id}`)
      .toBe(rights.has('employees.docs.qualifications') || rights.has('employees.docs.application'))
  }
}

describe(TAG, () => {
  it('without stored settings: the Leitung gets the switch by default; exceptions follow Qualifikationen or Bewerbung', () => {
    const { db, sqlite } = databaseBefore()
    const person = (name: string, role: Role, overrides: [string, 'grant' | 'revoke'][] = []) => {
      const { id } = addUser(db, name, role, null, 1)
      for (const [bundle, effect] of overrides) {
        sqlite.prepare('INSERT INTO user_bundle_overrides (user_id, bundle, effect) VALUES (?, ?, ?)').run(id, bundle, effect)
      }
      return { id, role }
    }
    const people = [
      person('leitung', 'admin'),
      person('leitung-ohne-quali', 'admin', [['docsQualifications', 'revoke']]),
      person('leitung-mit-uebrigen', 'admin', [['docsQualifications', 'revoke'], ['docsOther', 'grant']]),
      person('ma', 'observer'),
      person('ma-quali', 'observer', [['docsQualifications', 'grant']]),
      person('ma-uebrige', 'observer', [['docsOther', 'grant']]),
      person('ma-ohne-uebrige', 'observer', [['docsOther', 'revoke']]),
      person('gl-quali', 'group_lead', [['docsQualifications', 'grant']]),
      person('traeger', 'provider', [['docsQualifications', 'grant']]),
    ]
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare(`SELECT role FROM role_bundles WHERE bundle = 'docsRequired'`).all()).toEqual([])
    expect(sqlite.prepare(`SELECT u.username, o.effect FROM user_bundle_overrides o JOIN users u ON u.id = o.user_id
      WHERE o.bundle = 'docsRequired' ORDER BY u.id`).all()).toEqual([
      { username: 'leitung-ohne-quali', effect: 'revoke' },
      { username: 'ma-quali', effect: 'grant' },
      { username: 'ma-uebrige', effect: 'grant' },
      { username: 'gl-quali', effect: 'grant' },
    ])
    expectNobodyLosesOrGains(db, people)
    expect(accountRights(db, { ...people[0]!, facilityId: 1 }).permissions.has('employees.docs.required')).toBe(true)
    expect(accountRights(db, { ...people[3]!, facilityId: 1 }).permissions.has('employees.docs.required')).toBe(false)
  })

  it('with stored role settings: each role gets the switch where Qualifikationen or the other documents were on', () => {
    const { db, sqlite } = databaseBefore()
    sqlite.exec(`INSERT INTO role_bundles (role, bundle, enabled) VALUES
      ('admin', 'docsQualifications', 0), ('group_lead', 'docsQualifications', 1), ('observer', 'docsOther', 1), ('observer', 'docsQualifications', 0)`)
    const people = (['admin', 'group_lead', 'observer'] as const).map(role => ({ id: addUser(db, `u-${role}`, role, null, 1).id, role }))
    const { id } = addUser(db, 'leitung-quali', 'admin', null, 1)
    sqlite.prepare(`INSERT INTO user_bundle_overrides (user_id, bundle, effect) VALUES (?, 'docsQualifications', 'grant')`).run(id)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare(`SELECT role, enabled FROM role_bundles WHERE bundle = 'docsRequired' ORDER BY role`).all()).toEqual([
      { role: 'admin', enabled: 0 }, { role: 'group_lead', enabled: 1 }, { role: 'observer', enabled: 1 },
    ])
    expect(sqlite.prepare(`SELECT user_id, effect FROM user_bundle_overrides WHERE bundle = 'docsRequired'`).all()).toEqual([{ user_id: id, effect: 'grant' }])
    expectNobodyLosesOrGains(db, [...people, { id, role: 'admin' }])
  })
})
