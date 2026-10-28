import { describe, expect, it } from 'vitest'
import {
  BASELINE_KEYS, BUNDLE_AREA_LABELS, BUNDLE_AREAS, BUNDLE_DEFAULTS, BUNDLE_IDS, BUNDLES, DEFAULT_SCOPE, bundleOfKey,
  effectivePermissions, effectiveRights, expandBundles, isBundleId, roleBundleMap, type BundleId,
} from '../../shared/domain/permissionBundles'
import { PERMISSIONS, ROLE_DEFAULTS, resolvePermissions, type PermissionKey } from '../../shared/domain/permissions'
import { flaggedPermissions, teil1Permissions } from '../helpers/rights'

const sorted = (keys: Iterable<string>) => [...keys].sort()
const byId = new Map(BUNDLES.map(def => [def.id, def]))
const catalog = new Map(PERMISSIONS.map(permission => [permission.key, permission]))

/** Spec Teil 2 §2, verbatim: the keys of every switch. */
const SPEC_TABLE: Record<BundleId, PermissionKey[]> = {
  planView: ['plan.view'],
  planEdit: ['plan.edit', 'plan.staffing'],
  planRelease: ['plan.release'],
  leaveRequest: ['leave.request'],
  leavePlan: ['leave.plan'],
  timeOwn: ['time.own'],
  timeManage: ['time.manage'],
  employeesView: ['employees.view', 'leave.overview'],
  employeesEdit: ['employees.edit', 'employees.sickness'],
  contractView: ['employees.contractView'],
  contractEdit: ['employees.contractEdit'],
  employeesDelete: ['employees.delete'],
  talksManage: ['talks.manage'],
  personal: ['employees.personal'],
  payrollSensitive: ['employees.payroll', 'employees.sensitive'],
  docsQualifications: ['employees.docs.qualifications'],
  docsOther: ['employees.docs.contract', 'employees.docs.application', 'employees.docs.correspondence',
    'employees.docs.measures', 'employees.docs.salary'],
  childrenView: ['children.view'],
  childrenAttendance: ['children.attendance'],
  childrenEdit: ['children.edit'],
  childrenManage: ['children.manage', 'children.planned'],
  childrenOwnAccount: ['children.ownAccount'],
  formsFill: ['childForms.edit'],
  formsManage: ['childForms.manage', 'formTemplates.manage'],
  teamMeetingsWrite: ['teamMeetings.write'],
  teamMeetingsRelease: ['teamMeetings.manage'],
  cashBook: ['cash.view', 'cash.book'],
  cashClose: ['cash.close', 'cash.reopen'],
  calendarView: ['calendar.own'],
  calendarEdit: ['calendar.edit', 'closures.manage'],
  templatesView: ['printTemplates.view'],
  templatesEdit: ['printTemplates.edit'],
  settingsFacility: ['settings.facility'],
  usersManage: ['users.manage'],
}

/** The bundles and every bundle they need, transitively. */
function withRequired(ids: BundleId[]): BundleId[] {
  const all = new Set(ids)
  const pending = [...ids]
  while (pending.length > 0) {
    for (const required of byId.get(pending.pop()!)!.requires) {
      if (!all.has(required)) {
        all.add(required)
        pending.push(required)
      }
    }
  }
  return [...all]
}

describe('bundles', () => {
  it('are the switches of spec §2 with their keys verbatim', () => {
    expect(BUNDLES.map(def => def.id)).toEqual([...BUNDLE_IDS])
    for (const def of BUNDLES) expect(sorted(def.keys), def.id).toEqual(sorted(SPEC_TABLE[def.id]))
  })

  it('have a German label and a known area, in the page order of the areas', () => {
    for (const def of BUNDLES) {
      expect(def.label.length, def.id).toBeGreaterThan(0)
      expect(BUNDLE_AREAS, def.id).toContain(def.area)
    }
    const areaOrder = BUNDLES.map(def => BUNDLE_AREAS.indexOf(def.area))
    expect(areaOrder).toEqual([...areaOrder].sort((a, b) => a - b))
    expect(Object.keys(BUNDLE_AREA_LABELS)).toEqual([...BUNDLE_AREAS])
    expect(byId.get('cashClose')!.label).toBe('Monate abschließen und wieder öffnen')
  })

  it('scope only the children bundles view, attendance and edit, whose keys are scoped in the catalog', () => {
    expect(BUNDLES.filter(def => def.scoped).map(def => def.id)).toEqual(['childrenView', 'childrenAttendance', 'childrenEdit'])
    for (const def of BUNDLES.filter(bundle => bundle.scoped)) {
      for (const key of def.keys) expect(catalog.get(key)!.scoped, key).toBe(true)
    }
  })

  it('hold every grantable key exactly once; the baseline and the Träger-only keys are in none', () => {
    const counts = new Map<PermissionKey, number>()
    for (const def of BUNDLES) for (const key of def.keys) counts.set(key, (counts.get(key) ?? 0) + 1)
    for (const permission of PERMISSIONS) {
      const expected = permission.providerOnly || BASELINE_KEYS.includes(permission.key) ? 0 : 1
      expect(counts.get(permission.key) ?? 0, permission.key).toBe(expected)
    }
    expect(BASELINE_KEYS).toEqual(['talks.own'])
    for (const key of BASELINE_KEYS) expect(catalog.get(key)!.providerOnly).toBe(false)
  })

  it('make Personalschlüssel-Werte and Schulkinder-Einstellungen Träger-only', () => {
    expect(catalog.get('settings.staffing')!.providerOnly).toBe(true)
    expect(catalog.get('children.schoolSettings')!.providerOnly).toBe(true)
  })

  it('know the bundle of a key', () => {
    expect(bundleOfKey('leave.overview')).toBe('employeesView')
    expect(bundleOfKey('talks.own')).toBeUndefined()
    expect(bundleOfKey('rights.manage')).toBeUndefined()
    expect(isBundleId('childrenEdit')).toBe(true)
    expect(isBundleId('children.edit')).toBe(false)
  })
})

describe('bundle requirements', () => {
  it('are computed from the catalog requires and implies', () => {
    for (const def of BUNDLES) {
      const expected = new Set<BundleId>()
      for (const key of def.keys) {
        for (const other of [...catalog.get(key)!.requires, ...catalog.get(key)!.implies]) {
          const owner = bundleOfKey(other)
          if (owner && owner !== def.id) expected.add(owner)
        }
      }
      expect(sorted(def.requires), def.id).toEqual(sorted(expected))
    }
    expect(byId.get('planRelease')!.requires).toEqual(['planEdit'])
    expect(byId.get('leavePlan')!.requires).toEqual(['employeesView'])
    expect(sorted(byId.get('childrenManage')!.requires)).toEqual(['childrenEdit', 'childrenView'])
    expect(byId.get('cashClose')!.requires).toEqual(['cashBook'])
  })

  it('are complete: a bundle with everything it needs keeps all its keys after resolving', () => {
    for (const def of BUNDLES) {
      const resolved = resolvePermissions([...BASELINE_KEYS, ...expandBundles(withRequired([def.id]))])
      for (const key of def.keys) expect(resolved.has(key), `${def.id}: ${key}`).toBe(true)
    }
  })

  it('never need a Träger-only key, and no bundle needs itself', () => {
    for (const def of BUNDLES) {
      expect(def.requires, def.id).not.toContain(def.id)
      for (const key of def.keys) {
        for (const other of catalog.get(key)!.requires) expect(catalog.get(other)!.providerOnly, `${key} → ${other}`).toBe(false)
      }
    }
  })
})

describe('defaults (RF1, domain level)', () => {
  it('give exactly the Teil-1 rights, plus cash.reopen for the Leitung', () => {
    expect(sorted(effectivePermissions({ role: 'admin' }))).toEqual(sorted([...ROLE_DEFAULTS.admin, 'cash.reopen']))
    expect(sorted(effectivePermissions({ role: 'observer' }))).toEqual(sorted(ROLE_DEFAULTS.observer))
  })

  it('are closed: every default bundle has its required bundles', () => {
    for (const role of ['admin', 'observer'] as const) {
      for (const id of BUNDLE_DEFAULTS[role]) {
        for (const required of byId.get(id)!.requires) expect(BUNDLE_DEFAULTS[role], `${role}: ${id}`).toContain(required)
      }
      expect(new Set(BUNDLE_DEFAULTS[role]).size).toBe(BUNDLE_DEFAULTS[role].length)
    }
  })

  it('scope the children bundles to the facility for the Leitung and to the own group for a Mitarbeiter', () => {
    expect(DEFAULT_SCOPE).toEqual({ admin: 'facility', observer: 'group' })
    expect(effectiveRights({ role: 'observer' }).scopes.get('children.view')).toBe('group')
    expect(effectiveRights({ role: 'observer' }).scopes.get('children.attendance')).toBe('group')
    expect(effectiveRights({ role: 'admin' }).scopes.get('children.edit')).toBe('facility')
    expect(effectiveRights({ role: 'admin' }).scopes.has('children.manage')).toBe(false)
  })

  it('reproduce Teil 1 with the old flags moved into bundles, apart from cash.reopen', () => {
    const flagSets = [
      {}, { canEditChildren: true }, { isLeavePlanner: true }, { contractVisibleToAdmins: true },
      { canEditChildren: true, isLeavePlanner: true, contractVisibleToAdmins: true },
    ]
    for (const role of ['provider', 'admin', 'observer', 'terminal'] as const) {
      for (const flags of flagSets) {
        const before = new Set(teil1Permissions(role, flags))
        if (role === 'admin') before.add('cash.reopen')
        expect(sorted(flaggedPermissions(role, flags)), `${role} ${JSON.stringify(flags)}`).toEqual(sorted(before))
      }
    }
  })

  it('give the Träger every key and the tablet role none, whatever is stored', () => {
    const stored = { roleBundles: [{ bundle: 'planView', enabled: false, scope: null }], overrides: [{ bundle: 'cashBook', effect: 'revoke' as const, scope: null }] }
    expect(effectivePermissions({ role: 'provider', ...stored }).size).toBe(PERMISSIONS.length)
    expect(effectivePermissions({ role: 'terminal', ...stored, overrides: [{ bundle: 'planView', effect: 'grant', scope: null }] }).size).toBe(0)
  })
})

describe('resolver (RF2, domain level)', () => {
  it('applies a role setting to the role: off removes the bundle, on adds it', () => {
    const off = effectivePermissions({ role: 'admin', roleBundles: [{ bundle: 'cashClose', enabled: false, scope: null }] })
    expect(off.has('cash.close')).toBe(false)
    expect(off.has('cash.reopen')).toBe(false)
    expect(off.has('cash.book')).toBe(true)
    const on = effectivePermissions({ role: 'observer', roleBundles: [{ bundle: 'templatesEdit', enabled: true, scope: null }] })
    expect(on.has('printTemplates.edit')).toBe(true)
  })

  it('applies exceptions over the role both ways', () => {
    const roleBundles = [{ bundle: 'templatesEdit', enabled: true, scope: null }]
    expect(effectivePermissions({ role: 'observer', roleBundles, overrides: [{ bundle: 'templatesEdit', effect: 'revoke', scope: null }] })
      .has('printTemplates.edit')).toBe(false)
    expect(effectivePermissions({ role: 'observer', overrides: [{ bundle: 'templatesEdit', effect: 'grant', scope: null }] })
      .has('printTemplates.edit')).toBe(true)
    expect(effectivePermissions({ role: 'admin', overrides: [{ bundle: 'cashBook', effect: 'revoke', scope: null }] }).has('cash.view'))
      .toBe(false)
  })

  it('drops a bundle whose required bundle is missing, and the bundles that need it', () => {
    const rights = effectiveRights({ role: 'admin', overrides: [{ bundle: 'cashBook', effect: 'revoke', scope: null }] })
    expect(rights.bundles.has('cashClose')).toBe(false)
    expect(rights.permissions.has('cash.reopen')).toBe(false)
    const lonely = effectiveRights({ role: 'observer', overrides: [{ bundle: 'planRelease', effect: 'grant', scope: null }] })
    expect(lonely.bundles.has('planRelease')).toBe(false)
    expect(lonely.permissions.has('plan.release')).toBe(false)
    expect(lonely.permissions.has('plan.edit')).toBe(false)
  })

  it('keeps the scope: stored on the role, on the exception, else the role default', () => {
    const facility = effectiveRights({ role: 'observer', roleBundles: [{ bundle: 'childrenView', enabled: true, scope: 'facility' }] })
    expect(facility.scopes.get('children.view')).toBe('facility')
    expect(facility.scopes.get('children.attendance')).toBe('group')
    const granted = effectiveRights({ role: 'observer', overrides: [{ bundle: 'childrenEdit', effect: 'grant', scope: 'facility' }] })
    expect(granted.scopes.get('children.edit')).toBe('facility')
    const inherit = effectiveRights({ role: 'observer', overrides: [{ bundle: 'childrenEdit', effect: 'grant', scope: null }] })
    expect(inherit.scopes.get('children.edit')).toBe('group')
    const narrowed = effectiveRights({ role: 'admin', overrides: [{ bundle: 'childrenView', effect: 'grant', scope: 'group' }] })
    expect(narrowed.scopes.get('children.view')).toBe('group')
    expect(roleBundleMap('observer', [{ bundle: 'childrenView', enabled: true, scope: 'bogus' as never }]).get('childrenView')).toBe('group')
    expect(roleBundleMap('observer', [{ bundle: 'planView', enabled: true, scope: 'facility' }]).get('planView')).toBeNull()
  })

  it('ignores unknown bundle ids in role settings and exceptions', () => {
    const rights = effectivePermissions({
      role: 'observer',
      roleBundles: [{ bundle: 'rights.manage', enabled: true, scope: null }, { bundle: 'nonsense', enabled: false, scope: null }],
      overrides: [{ bundle: 'settings.staffing', effect: 'grant', scope: null }, { bundle: 'planView', effect: 'bogus' as never, scope: null }],
    })
    expect(sorted(rights)).toEqual(sorted(ROLE_DEFAULTS.observer))
  })

  it('never gives a Träger-only key to anyone else', () => {
    const everything = BUNDLE_IDS.map(bundle => ({ bundle, effect: 'grant' as const, scope: 'facility' as const }))
    for (const role of ['admin', 'observer'] as const) {
      const rights = effectivePermissions({ role, overrides: everything })
      for (const permission of PERMISSIONS) {
        expect(rights.has(permission.key), `${role}: ${permission.key}`).toBe(!permission.providerOnly)
      }
    }
  })
})
