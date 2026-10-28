import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb, type Db } from '../../server/db/client'
import { roleBundles, userBundleOverrides, users } from '../../server/db/schema'
import { toSessionUser } from '../../server/services/auth'
import { accountPermissions } from '../../server/services/permissions'
import type { PermissionKey } from '../../shared/domain/permissions'
import { addEmployee, addUser, createTestDb } from '../helpers/fixtures'
import { teil1Permissions } from '../helpers/rights'

const MIGRATIONS = 'server/db/migrations'
const sorted = (keys: Iterable<string>) => [...keys].sort()

/** A database migrated with drizzle's migrator up to and including `last`, as an older app version left it. */
function databaseAt(last: string): { db: Db; sqlite: Database.Database } {
  const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.filter(entry => entry.tag.slice(0, 4) <= last)
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  const { db, sqlite } = createDb(':memory:')
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder })
  rmSync(folder, { recursive: true, force: true })
  return { db, sqlite }
}

/** Teil 1's answer plus the one approved change: the Leitung reopens cash months. */
function expectedNow(before: ReadonlySet<PermissionKey>, role: string): string[] {
  return sorted(role === 'admin' ? [...before, 'cash.reopen'] : before)
}

describe('rights with an empty settings database (RF1)', () => {
  it('stores nothing and gives every role its Teil-1 rights, plus cash.reopen for the Leitung', () => {
    const db = createTestDb()
    const accounts = [
      addUser(db, 'traeger', 'provider'), addUser(db, 'leitung', 'admin'),
      addUser(db, 'staff', 'observer', addEmployee(db, 'Staff')), addUser(db, 'tablet', 'terminal'),
    ]
    expect(db.select().from(roleBundles).all()).toEqual([])
    expect(db.select().from(userBundleOverrides).all()).toEqual([])
    for (const account of accounts) {
      expect(sorted(accountPermissions(db, account)), account.role).toEqual(expectedNow(teil1Permissions(account.role), account.role))
      expect(sorted(account.permissions), account.role).toEqual(expectedNow(teil1Permissions(account.role), account.role))
    }
  })
})

describe('migration 0064 rights (RF1)', () => {
  /**
   * A database of the version before the rights page with every old per-person grant set: a child-editing Mitarbeiter
   * (and a Leitung and a tablet with the flag stored, which never counted), leave planners (Leitung of facility 1 and 2,
   * a Träger) and the contract switch; also flagged Mitarbeiter accounts that cannot sign in (deactivated, without
   * employee, employee left), whose stored flag moves like any other.
   */
  function filled(contractSwitch: 'true' | 'false' | null) {
    const { db, sqlite } = databaseAt('0063')
    sqlite.exec(`
      INSERT INTO facilities (id, name, sort_order) VALUES (2, 'Zweite Kita', 1);
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1), (2, 'Bea', 1), (3, 'Cleo', 2), (4, 'Dora', 1),
        (6, 'Gina', 1);
      INSERT INTO employees (id, name, facility_id, left_on) VALUES (5, 'Fritz', 1, '2020-01-31');
      INSERT INTO users (id, username, password_hash, role, employee_id, facility_id, can_edit_children) VALUES
        (1, 'traeger', 'x', 'provider', NULL, 1, 0),
        (2, 'leitung', 'x', 'admin', NULL, 1, 1),
        (3, 'leitung2', 'x', 'admin', NULL, 2, 0),
        (4, 'leitung3', 'x', 'admin', 4, 1, 0),
        (5, 'anna', 'x', 'observer', 1, NULL, 1),
        (6, 'bea', 'x', 'observer', 2, NULL, 0),
        (7, 'cleo', 'x', 'observer', 3, NULL, 1),
        (8, 'tablet', 'x', 'terminal', NULL, 1, 1),
        (9, 'eva', 'x', 'observer', NULL, NULL, 1),
        (10, 'fritz', 'x', 'observer', 5, NULL, 1);
      INSERT INTO users (id, username, password_hash, role, employee_id, facility_id, can_edit_children, active) VALUES
        (11, 'gina', 'x', 'observer', 6, NULL, 1, 0);
      INSERT INTO leave_planners (user_id) VALUES (1), (2), (3);
    `)
    if (contractSwitch !== null) {
      sqlite.prepare(`INSERT INTO app_settings (key, value) VALUES ('contract_visible_to_admins', ?)`).run(contractSwitch)
    }
    const planners = new Set([1, 2, 3])
    const rows = sqlite.prepare('SELECT id, role, facility_id, employee_id, can_edit_children FROM users ORDER BY id').all() as
      { id: number; role: 'provider' | 'admin' | 'observer' | 'terminal'; facility_id: number | null; employee_id: number | null;
        can_edit_children: number }[]
    const employeeFacility = new Map([[1, 1], [2, 1], [3, 2], [4, 1], [5, 1], [6, 1]])
    /** Teil 1's rights of every account in facilities 1 and 2 (a Leitung plans only in its own facility). */
    const before = new Map(rows.map((row) => {
      const own = row.role === 'observer' ? employeeFacility.get(row.employee_id!) ?? null : row.facility_id
      const at = (facilityId: number) => teil1Permissions(row.role, {
        canEditChildren: row.can_edit_children === 1,
        isLeavePlanner: row.role === 'admin' && planners.has(row.id) && own === facilityId,
        contractVisibleToAdmins: contractSwitch === 'true',
      })
      return [row.id, { role: row.role, 1: at(1), 2: at(2) }]
    }))
    return { db, sqlite, before }
  }

  for (const contractSwitch of ['true', 'false', null] as const) {
    it(`gives every account the same rights as before (contract switch ${contractSwitch ?? 'never set'})`, () => {
      const { db, before } = filled(contractSwitch)
      migrateDb(db, MIGRATIONS)
      for (const row of db.select().from(users).all()) {
        const account = toSessionUser(db, row)
        const was = before.get(row.id)!
        for (const facilityId of [1, 2] as const) {
          expect(sorted(accountPermissions(db, account, facilityId)), `${row.username} in facility ${facilityId}`)
            .toEqual(expectedNow(was[facilityId], was.role))
        }
        // A Mitarbeiter without employee has no facility; there it counts like any facility (no leave planning).
        expect(sorted(account.permissions), row.username).toEqual(expectedNow(was[(account.facilityId ?? 1) as 1 | 2], was.role))
      }
    })
  }

  it('moves the old grants into exceptions and the Leitung\'s role setting, nothing else', () => {
    const { db, sqlite } = filled('true')
    migrateDb(db, MIGRATIONS)
    expect(db.select().from(userBundleOverrides).all().sort((a, b) => a.userId - b.userId)).toEqual([
      { userId: 2, bundle: 'leavePlan', effect: 'grant', scope: null },
      { userId: 3, bundle: 'leavePlan', effect: 'grant', scope: null },
      { userId: 5, bundle: 'childrenEdit', effect: 'grant', scope: 'group' },
      { userId: 7, bundle: 'childrenEdit', effect: 'grant', scope: 'group' },
      { userId: 9, bundle: 'childrenEdit', effect: 'grant', scope: 'group' },
      { userId: 10, bundle: 'childrenEdit', effect: 'grant', scope: 'group' },
      { userId: 11, bundle: 'childrenEdit', effect: 'grant', scope: 'group' },
    ])
    expect(db.select().from(roleBundles).all()).toEqual([{ role: 'admin', bundle: 'contractView', enabled: true, scope: null }])
    // The old data stays (leave_planners: the notification recipients).
    expect(sqlite.prepare('SELECT user_id FROM leave_planners ORDER BY user_id').all()).toEqual([{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }])
    expect(sqlite.prepare('SELECT count(*) AS n FROM users WHERE can_edit_children = 1').get()).toEqual({ n: 7 })
    expect(sqlite.prepare(`SELECT value FROM app_settings WHERE key = 'contract_visible_to_admins'`).get()).toEqual({ value: 'true' })
  })

  it('stores a switched-off contract switch as a disabled role row, and nothing without one', () => {
    const off = filled('false')
    migrateDb(off.db, MIGRATIONS)
    expect(off.db.select().from(roleBundles).all()).toEqual([{ role: 'admin', bundle: 'contractView', enabled: false, scope: null }])
    const never = filled(null)
    migrateDb(never.db, MIGRATIONS)
    expect(never.db.select().from(roleBundles).all()).toEqual([])
  })

  it('drops the exceptions with the account', () => {
    const { db, sqlite } = filled('true')
    migrateDb(db, MIGRATIONS)
    sqlite.exec('DELETE FROM users WHERE id = 5')
    expect(db.select().from(userBundleOverrides).all().map(row => row.userId).sort((a, b) => a - b)).toEqual([2, 3, 7, 9, 10, 11])
  })
})
