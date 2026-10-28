import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AREA_LABELS, PERMISSIONS, PERMISSION_AREAS, PERMISSION_KEYS, ROLE_DEFAULTS, can, effectivePermissions,
  resolvePermissions, type PermissionInput, type PermissionKey,
} from '../../shared/domain/permissions'

const plain = { canEditChildren: false, isLeavePlanner: false, contractVisibleToAdmins: false }
function input(over: Partial<PermissionInput> & Pick<PermissionInput, 'role'>): PermissionInput {
  return { ...plain, ...over }
}
function sorted(keys: Iterable<PermissionKey>): PermissionKey[] {
  return [...keys].sort()
}
const byKey = new Map(PERMISSIONS.map(def => [def.key, def]))

describe('permission catalog', () => {
  it('has the 56 keys of the inventory, each once and in catalog order', () => {
    expect(PERMISSIONS).toHaveLength(56)
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

  it('fixes the P-fix keys and the three recommended ones at the Träger', () => {
    expect(sorted(PERMISSIONS.filter(def => def.providerOnly).map(def => def.key))).toEqual(sorted([
      'leave.configure', 'employees.moveFacility', 'children.deleteArchived', 'children.moveFacility', 'cash.purge',
      'settings.retention', 'settings.otherFacility', 'users.providerAccounts', 'rights.manage', 'facilities.manage',
      'retention.delete', 'backup.download',
      'printTemplates.global', 'settings.absenceCodes', 'settings.groups',
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
})

describe('role defaults', () => {
  it('never contains a key fixed at the Träger', () => {
    for (const role of ['admin', 'observer'] as const) {
      for (const key of ROLE_DEFAULTS[role]) expect(byKey.get(key)!.providerOnly, `${role}: ${key}`).toBe(false)
    }
  })

  it('gives the Leitung every grantable key apart from the Träger\'s and the two per-person ones', () => {
    const notDefault: PermissionKey[] = ['employees.contractEdit', 'children.schoolSettings', 'cash.reopen',
      'settings.staffing', 'employees.contractView', 'leave.plan']
    const expected = PERMISSIONS.filter(def => !def.providerOnly && !notDefault.includes(def.key)).map(def => def.key)
    expect(sorted(ROLE_DEFAULTS.admin)).toEqual(sorted(expected))
    expect(ROLE_DEFAULTS.admin).toHaveLength(35)
  })

  it('gives the Mitarbeiter the own data, the released plan, team meetings and the child keys of the tablet', () => {
    expect(sorted(ROLE_DEFAULTS.observer)).toEqual(sorted(['plan.view', 'leave.request', 'time.own', 'talks.own',
      'teamMeetings.write', 'calendar.own', 'children.view', 'children.attendance']))
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

describe('effectivePermissions', () => {
  it('gives the Träger every key, whatever the flags', () => {
    expect(sorted(effectivePermissions(input({ role: 'provider' })))).toEqual(sorted(PERMISSION_KEYS))
    expect(effectivePermissions(input({ role: 'provider', canEditChildren: true, isLeavePlanner: true })).size).toBe(56)
  })

  it('gives the tablet role nothing, whatever the flags', () => {
    expect(effectivePermissions(input({ role: 'terminal' })).size).toBe(0)
    expect(effectivePermissions({ role: 'terminal', canEditChildren: true, isLeavePlanner: true,
      contractVisibleToAdmins: true }).size).toBe(0)
  })

  it('gives Leitung and Mitarbeiter their defaults without flags', () => {
    expect(sorted(effectivePermissions(input({ role: 'admin' })))).toEqual(sorted(ROLE_DEFAULTS.admin))
    expect(sorted(effectivePermissions(input({ role: 'observer' })))).toEqual(sorted(ROLE_DEFAULTS.observer))
  })

  it('lets a Mitarbeiter with „darf Kinderakten pflegen“ edit children, still only at the tablet', () => {
    const flagged = effectivePermissions(input({ role: 'observer', canEditChildren: true }))
    expect(can(flagged, 'children.edit')).toBe(true)
    expect(can(flagged, 'children.ownAccount')).toBe(false)
    expect(can(flagged, 'children.manage')).toBe(false)
    expect(sorted(flagged)).toEqual(sorted([...ROLE_DEFAULTS.observer, 'children.edit']))
    expect(can(effectivePermissions(input({ role: 'observer' })), 'children.edit')).toBe(false)
  })

  it('lets a Leitung plan leave only as chosen planner of the facility', () => {
    expect(can(effectivePermissions(input({ role: 'admin', isLeavePlanner: true })), 'leave.plan')).toBe(true)
    expect(can(effectivePermissions(input({ role: 'admin' })), 'leave.plan')).toBe(false)
    // leave_planners only holds managers; a Mitarbeiter never plans.
    expect(can(effectivePermissions(input({ role: 'observer', isLeavePlanner: true })), 'leave.plan')).toBe(false)
  })

  it('shows the Leitung the contract fields only while the Träger\'s switch is on', () => {
    expect(can(effectivePermissions(input({ role: 'admin', contractVisibleToAdmins: true })), 'employees.contractView'))
      .toBe(true)
    expect(can(effectivePermissions(input({ role: 'admin' })), 'employees.contractView')).toBe(false)
    expect(can(effectivePermissions(input({ role: 'admin', contractVisibleToAdmins: true })), 'employees.contractEdit'))
      .toBe(false)
    expect(can(effectivePermissions(input({ role: 'observer', contractVisibleToAdmins: true })), 'employees.contractView'))
      .toBe(false)
  })

  it('ignores the child flag for the Leitung, who edits children anyway', () => {
    expect(sorted(effectivePermissions(input({ role: 'admin', canEditChildren: true })))).toEqual(sorted(ROLE_DEFAULTS.admin))
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
    expect(routes).toHaveLength(300)
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
    expect(fixture['print-templates/index.get.ts']).toEqual(['provider', 'admin', 'terminal'])
    expect(fixture['children/index.get.ts']).toEqual(['provider', 'admin', 'tablet:provider', 'tablet:admin',
      'tablet:observerEditor', 'tablet:observer', 'tablet:noAccount'])
    expect(fixture['children/[id]/master.put.ts']).toEqual(['provider', 'admin', 'tablet:provider', 'tablet:admin',
      'tablet:observerEditor'])
    expect(fixture['children/archive.get.ts']).toEqual(['provider', 'admin', 'tablet:provider', 'tablet:admin'])
    // The tablet's unlock is only named where a child guard reads it; elsewhere 'terminal' stands for the tablet.
    expect(fixture['health.get.ts']).toEqual(['anonymous', 'provider', 'admin', 'observer', 'terminal'])
  })
})
