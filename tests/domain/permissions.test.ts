import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AREA_LABELS, PERMISSIONS, PERMISSION_AREAS, PERMISSION_KEYS, ROLE_DEFAULTS, can, resolvePermissions,
  type PermissionKey,
} from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'
import { flaggedPermissions, type LegacyFlags } from '../helpers/rights'

/** The rights of the role with Teil 1's per-person flags, as migration 0064 moved them into bundles. */
function rights(over: LegacyFlags & { role: Role }): ReadonlySet<PermissionKey> {
  const { role, ...flags } = over
  return flaggedPermissions(role, flags)
}
function sorted(keys: Iterable<PermissionKey>): PermissionKey[] {
  return [...keys].sort()
}
const byKey = new Map(PERMISSIONS.map(def => [def.key, def]))
/** The keys of the personnel file (spec Personalakte §6); the Leitung gets the first and the qualifications by default. */
const PERSONNEL_KEYS: PermissionKey[] = ['employees.personal', 'employees.sensitive', 'employees.payroll',
  'employees.docs.qualifications', 'employees.docs.contract', 'employees.docs.application', 'employees.docs.correspondence',
  'employees.docs.measures', 'employees.docs.salary']
const PERSONNEL_TRAEGER_ONLY = PERSONNEL_KEYS.filter(key => key !== 'employees.personal' && key !== 'employees.docs.qualifications')

describe('permission catalog', () => {
  it('has the 65 keys of the inventory and the personnel file, each once and in catalog order', () => {
    expect(PERMISSIONS).toHaveLength(65)
    expect(PERMISSIONS.map(def => def.key)).toEqual([...PERMISSION_KEYS])
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length)
  })

  it('gives every key a German label and a known area', () => {
    for (const def of PERMISSIONS) {
      expect(def.label.length, def.key).toBeGreaterThan(5)
      expect(PERMISSION_AREAS, def.key).toContain(def.area)
    }
    for (const area of PERMISSION_AREAS) {
      expect(AREA_LABELS[area].length).toBeGreaterThan(3)
      expect(PERMISSIONS.some(def => def.area === area), area).toBe(true)
    }
  })

  it('only names known keys in requires and implies, never the key itself', () => {
    for (const def of PERMISSIONS) {
      for (const other of [...def.requires, ...def.implies]) {
        expect(byKey.has(other), `${def.key} → ${other}`).toBe(true)
        expect(other, def.key).not.toBe(def.key)
      }
    }
  })

  it('has no cycles through requires and implies', () => {
    const state = new Map<PermissionKey, 'open' | 'done'>()
    function visit(key: PermissionKey, path: PermissionKey[]): void {
      if (state.get(key) === 'done') return
      expect(state.get(key), [...path, key].join(' → ')).not.toBe('open')
      state.set(key, 'open')
      const def = byKey.get(key)!
      for (const next of [...def.requires, ...def.implies]) visit(next, [...path, key])
      state.set(key, 'done')
    }
    for (const key of PERMISSION_KEYS) visit(key, [])
  })

  it('never lets a grantable key depend on a key fixed at the Träger', () => {
    for (const def of PERMISSIONS.filter(def => !def.providerOnly)) {
      for (const other of [...def.requires, ...def.implies]) {
        expect(byKey.get(other)!.providerOnly, `${def.key} → ${other}`).toBe(false)
      }
    }
  })

  it('fixes the P-fix keys, the three recommended ones and the two of the rights page at the Träger', () => {
    expect(sorted(PERMISSIONS.filter(def => def.providerOnly).map(def => def.key))).toEqual(sorted([
      'leave.configure', 'employees.moveFacility', 'children.deleteArchived', 'children.moveFacility', 'cash.purge',
      'settings.retention', 'settings.otherFacility', 'users.providerAccounts', 'rights.manage', 'facilities.manage',
      'retention.delete', 'backup.download',
      'printTemplates.global', 'settings.absenceCodes', 'settings.groups',
      // Teil 2: „nur Träger“ on the rights page (spec §2); the Leitung never had them.
      'settings.staffing', 'children.schoolSettings',
    ]))
  })

  it('marks the group-scoped child keys', () => {
    expect(sorted(PERMISSIONS.filter(def => def.scoped).map(def => def.key)))
      .toEqual(sorted(['children.view', 'children.attendance', 'children.edit', 'childForms.edit']))
  })

  it('records the requires and implies of the inventory', () => {
    expect(byKey.get('plan.edit')!.requires).toEqual(['plan.view'])
    expect(byKey.get('plan.release')!.implies).toEqual(['plan.edit'])
    expect(byKey.get('teamMeetings.manage')!.implies).toEqual(['teamMeetings.write'])
    expect(byKey.get('children.manage')!.requires).toEqual(['children.view', 'children.edit'])
    expect(byKey.get('leave.plan')!.requires).toEqual(['leave.overview'])
    expect(byKey.get('employees.contractEdit')!.requires).toEqual(['employees.contractView'])
    expect(byKey.get('cash.reopen')!.requires).toEqual(['cash.close'])
  })

  it('has the grantable keys of the personnel file in the area Mitarbeiter, each requiring employees.view', () => {
    const keys = PERMISSION_KEYS.filter(key => PERSONNEL_KEYS.includes(key))
    expect(keys).toEqual(PERSONNEL_KEYS)
    for (const key of PERSONNEL_KEYS) {
      expect(byKey.get(key), key).toMatchObject({ area: 'employees', requires: ['employees.view'], implies: [], scoped: false,
        providerOnly: false })
    }
    expect(byKey.get('employees.personal')!.label).toBe('Anschrift, Kontakt und Geburtsdatum')
    expect(byKey.get('employees.payroll')!.label).toBe('Lohn und Steuer')
    expect(byKey.get('employees.docs.measures')!.label).toBe('Dokumente: Arbeitsrechtliche Maßnahmen')
    expect(byKey.get('employees.docs.contract')!.label).toBe('Dokumente: Vertrag und Nachträge, Stellenbeschreibung')
  })
})

describe('role defaults', () => {
  it('never contains a key fixed at the Träger', () => {
    for (const role of ['admin', 'observer'] as const) {
      for (const key of ROLE_DEFAULTS[role]) expect(byKey.get(key)!.providerOnly, `${role}: ${key}`).toBe(false)
    }
  })

  it('gives the Leitung every grantable key apart from the Träger\'s and the two per-person ones', () => {
    const notDefault: PermissionKey[] = ['employees.contractEdit', 'children.schoolSettings', 'cash.reopen',
      'settings.staffing', 'employees.contractView', 'leave.plan', ...PERSONNEL_TRAEGER_ONLY]
    const expected = PERMISSIONS.filter(def => !def.providerOnly && !notDefault.includes(def.key)).map(def => def.key)
    expect(sorted(ROLE_DEFAULTS.admin)).toEqual(sorted(expected))
    expect(ROLE_DEFAULTS.admin).toHaveLength(37)
  })

  it('gives the Mitarbeiter the own data, the released plan, team meetings, the child keys of the tablet and the print templates to read', () => {
    expect(sorted(ROLE_DEFAULTS.observer)).toEqual(sorted(['plan.view', 'leave.request', 'time.own', 'talks.own',
      'teamMeetings.write', 'calendar.own', 'children.view', 'children.attendance', 'printTemplates.view']))
    // Reading only: changing the templates and their categories stays with Leitung and Träger.
    expect(ROLE_DEFAULTS.observer).not.toContain('printTemplates.edit')
  })

  it('lists each default once and keeps them closed under requires and implies', () => {
    for (const role of ['admin', 'observer'] as const) {
      expect(new Set(ROLE_DEFAULTS[role]).size).toBe(ROLE_DEFAULTS[role].length)
      expect(sorted(resolvePermissions(ROLE_DEFAULTS[role]))).toEqual(sorted(ROLE_DEFAULTS[role]))
    }
  })
})

describe('resolvePermissions', () => {
  it('adds what a key implies', () => {
    expect(sorted(resolvePermissions(['plan.view', 'plan.release']))).toEqual(['plan.edit', 'plan.release', 'plan.view'])
    expect(sorted(resolvePermissions(['teamMeetings.manage']))).toEqual(['teamMeetings.manage', 'teamMeetings.write'])
  })

  it('drops a key whose requirement is missing, also down a chain', () => {
    expect(sorted(resolvePermissions(['employees.delete']))).toEqual([])
    expect(sorted(resolvePermissions(['employees.delete', 'employees.edit']))).toEqual([])
    expect(sorted(resolvePermissions(['employees.delete', 'employees.edit', 'employees.view'])))
      .toEqual(['employees.delete', 'employees.edit', 'employees.view'])
    expect(sorted(resolvePermissions(['children.view', 'children.manage']))).toEqual(['children.view'])
  })

  it('drops a key whose implied key cannot hold', () => {
    // plan.release implies plan.edit, which needs plan.view.
    expect(sorted(resolvePermissions(['plan.release']))).toEqual([])
  })
})

describe('effectivePermissions with the old flags moved into bundles', () => {
  it('gives the Träger every key, whatever the flags', () => {
    expect(sorted(rights({ role: 'provider' }))).toEqual(sorted(PERMISSION_KEYS))
    expect(rights({ role: 'provider', canEditChildren: true, isLeavePlanner: true }).size).toBe(65)
  })

  it('gives the tablet role nothing, whatever the flags', () => {
    expect(rights({ role: 'terminal' }).size).toBe(0)
    expect(rights({ role: 'terminal', canEditChildren: true, isLeavePlanner: true,
      contractVisibleToAdmins: true }).size).toBe(0)
  })

  it('gives Leitung and Mitarbeiter their defaults without flags; the Leitung now also reopens cash months', () => {
    expect(sorted(rights({ role: 'admin' }))).toEqual(sorted([...ROLE_DEFAULTS.admin, 'cash.reopen']))
    expect(sorted(rights({ role: 'observer' }))).toEqual(sorted(ROLE_DEFAULTS.observer))
  })

  it('lets a Mitarbeiter with „darf Kinderakten pflegen“ edit children, still only at the tablet', () => {
    const flagged = rights({ role: 'observer', canEditChildren: true })
    expect(can(flagged, 'children.edit')).toBe(true)
    expect(can(flagged, 'children.ownAccount')).toBe(false)
    expect(can(flagged, 'children.manage')).toBe(false)
    expect(sorted(flagged)).toEqual(sorted([...ROLE_DEFAULTS.observer, 'children.edit']))
    expect(can(rights({ role: 'observer' }), 'children.edit')).toBe(false)
  })

  it('lets a Leitung plan leave only as chosen planner of the facility', () => {
    expect(can(rights({ role: 'admin', isLeavePlanner: true }), 'leave.plan')).toBe(true)
    expect(can(rights({ role: 'admin' }), 'leave.plan')).toBe(false)
    // leave_planners only holds managers; a Mitarbeiter never plans.
    expect(can(rights({ role: 'observer', isLeavePlanner: true }), 'leave.plan')).toBe(false)
  })

  it('shows the Leitung the contract fields only while the Träger\'s switch is on', () => {
    expect(can(rights({ role: 'admin', contractVisibleToAdmins: true }), 'employees.contractView'))
      .toBe(true)
    expect(can(rights({ role: 'admin' }), 'employees.contractView')).toBe(false)
    expect(can(rights({ role: 'admin', contractVisibleToAdmins: true }), 'employees.contractEdit'))
      .toBe(false)
    expect(can(rights({ role: 'observer', contractVisibleToAdmins: true }), 'employees.contractView'))
      .toBe(false)
  })

  it('gives the Leitung address, contact, birth date and the qualifications folder of the personnel file, nothing else of it', () => {
    const leitung = rights({ role: 'admin', contractVisibleToAdmins: true })
    expect(PERSONNEL_KEYS.filter(key => can(leitung, key))).toEqual(['employees.personal', 'employees.docs.qualifications'])
    expect(PERSONNEL_KEYS.filter(key => can(rights({ role: 'observer', canEditChildren: true }), key)))
      .toEqual([])
    expect(PERSONNEL_KEYS.filter(key => can(rights({ role: 'provider' }), key))).toEqual(PERSONNEL_KEYS)
  })

  it('ignores the child flag for the Leitung, who edits children anyway', () => {
    expect(sorted(rights({ role: 'admin', canEditChildren: true })))
      .toEqual(sorted([...ROLE_DEFAULTS.admin, 'cash.reopen']))
  })
})

describe('route access before the switch (tests/fixtures/route-access-before.json)', () => {
  const apiDir = join(process.cwd(), 'server', 'api')
  const routes = (readdirSync(apiDir, { recursive: true }) as string[])
    .map(file => relative(apiDir, join(apiDir, file)).split(sep).join('/'))
    .filter(file => file.endsWith('.ts'))
    .sort()
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'route-access-before.json'), 'utf8')) as
    Record<string, string[]>
  const actors = ['anonymous', 'provider', 'admin', 'observer', 'terminal', 'tablet:provider', 'tablet:admin',
    'tablet:observerEditor', 'tablet:observer', 'tablet:noAccount']

  it('covers every file under server/api, and nothing else', () => {
    expect(routes).toHaveLength(312)
    expect(Object.keys(fixture).sort()).toEqual(routes)
  })

  it('names only known actors, in a fixed order, and every route lets someone in', () => {
    for (const [route, allowed] of Object.entries(fixture)) {
      expect(allowed.length, route).toBeGreaterThan(0)
      for (const actor of allowed) expect(actors, route).toContain(actor)
      expect(allowed, route).toEqual(actors.filter(actor => allowed.includes(actor)))
    }
  })

  it('records the guards of a few known routes', () => {
    expect(fixture['backup.get.ts']).toEqual(['provider'])
    expect(fixture['entries/index.post.ts']).toEqual(['provider', 'admin'])
    expect(fixture['my/time.get.ts']).toEqual(['provider', 'admin', 'observer'])
    expect(fixture['plan/[year]/[month].get.ts']).toEqual(['provider', 'admin', 'observer', 'terminal'])
    expect(fixture['terminal/stamp.post.ts']).toEqual(['terminal'])
    expect(fixture['print-templates/index.get.ts']).toEqual(['provider', 'admin', 'observer', 'terminal'])
    expect(fixture['children/index.get.ts']).toEqual(['provider', 'admin', 'tablet:provider', 'tablet:admin',
      'tablet:observerEditor', 'tablet:observer', 'tablet:noAccount'])
    expect(fixture['children/[id]/master.put.ts']).toEqual(['provider', 'admin', 'tablet:provider', 'tablet:admin',
      'tablet:observerEditor'])
    expect(fixture['children/archive.get.ts']).toEqual(['provider', 'admin', 'tablet:provider', 'tablet:admin'])
    // The one approved change of Teil 2: the Leitung reopens closed cash months.
    expect(fixture['cash/boxes/[id]/reopen.post.ts']).toEqual(['provider', 'admin'])
    // The tablet's unlock is only named where a child guard reads it; elsewhere 'terminal' stands for the tablet.
    expect(fixture['health.get.ts']).toEqual(['anonymous', 'provider', 'admin', 'observer', 'terminal'])
  })
})
