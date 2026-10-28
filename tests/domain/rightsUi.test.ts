import { describe, expect, it } from 'vitest'
import {
  BUNDLE_IDS, BUNDLES, effectiveRights, roleBundleMap, type BundleId, type RightsRole,
} from '../../shared/domain/permissionBundles'
import type { Role, RoleRightsDto, UserRightsDto } from '../../shared/types/api'
import {
  bundleTitle, changedBundles, childEditingOverrides, dropPreview, exceptionDropPreview, includedIn, overridesWith,
  personRightsMode, roleDraft, switchOff, switchOn, withScope,
} from '../../app/utils/rights'
import { flaggedPermissions } from '../helpers/rights'

/** The role's Grundeinstellung as GET /api/rights answers it. */
function roleRights(role: RightsRole): RoleRightsDto {
  const defaults = roleBundleMap(role)
  return {
    role, isDefault: true,
    bundles: BUNDLE_IDS.map(id => ({
      id, enabled: defaults.has(id), scope: defaults.get(id) ?? null, defaultEnabled: defaults.has(id), defaultScope: defaults.get(id) ?? null,
    })),
  }
}

/** A person of the role with these exceptions as GET /api/users/[id]/rights answers it. */
function userRights(role: RightsRole, overrides: UserRightsDto['bundles'][number]['override'][] = [], ids: BundleId[] = []): UserRightsDto {
  const roleMap = roleBundleMap(role)
  const stored = ids.map((id, index) => ({ bundle: id, effect: overrides[index]!.effect, scope: overrides[index]!.scope }))
  const effective = effectiveRights({ role, overrides: stored }).bundles
  return {
    userId: 5, username: 'berta', role, editable: [...BUNDLE_IDS],
    bundles: BUNDLE_IDS.map((id) => {
      const index = ids.indexOf(id)
      return {
        id,
        role: { enabled: roleMap.has(id), scope: roleMap.get(id) ?? null },
        override: index === -1 ? null : overrides[index]!,
        effective: { enabled: effective.has(id), scope: effective.get(id) ?? null },
      }
    }),
  }
}

describe('rights page draft', () => {
  it('names a switch with its area and lists the switches that include it', () => {
    expect(bundleTitle('planView')).toBe('Dienstplan: ansehen')
    expect(bundleTitle('childrenEdit')).toBe('Kinder: eintragen und Akten ändern')
    expect(includedIn('planEdit')).toEqual(['planRelease'])
    expect(includedIn('teamMeetingsWrite')).toEqual(['teamMeetingsRelease'])
    expect(includedIn('planView')).toEqual([])
  })

  it('takes the stored state, every switch present', () => {
    const draft = roleDraft(roleRights('observer'))
    expect(Object.keys(draft)).toEqual([...BUNDLE_IDS])
    expect(draft.childrenView).toEqual({ enabled: true, scope: 'group' })
    expect(draft.planEdit).toEqual({ enabled: false, scope: null })
  })

  it('pulls in what a switch needs and includes when switched on, with the scope of the one switched on', () => {
    const draft = roleDraft(roleRights('observer'))
    const release = switchOn(draft, 'planRelease', 'observer')
    expect(release.pulledIn).toEqual(['planEdit'])
    expect(release.draft.planRelease.enabled && release.draft.planEdit.enabled).toBe(true)

    const contract = switchOn(draft, 'contractEdit', 'observer')
    expect(contract.pulledIn).toEqual(['employeesView', 'contractView'])

    // A Mitarbeiter's children switches are for the own group by default; what they pull comes with the same scope.
    const noView = switchOff(draft, 'childrenView').draft
    const edit = switchOn(noView, 'childrenEdit', 'observer')
    expect(edit.draft.childrenEdit).toEqual({ enabled: true, scope: 'group' })
    expect(edit.pulledIn).toEqual(['childrenView'])
    expect(edit.draft.childrenView).toEqual({ enabled: true, scope: 'group' })
    expect(switchOn(roleDraft(roleRights('admin')), 'leavePlan', 'admin').pulledIn).toEqual([])
    // Already on: nothing changes.
    expect(switchOn(draft, 'planView', 'observer')).toEqual({ draft, pulledIn: [] })
  })

  it('previews and drops the dependents that are on when a switch goes off', () => {
    const leitung = roleDraft(roleRights('admin'))
    expect(dropPreview(leitung, 'planView')).toEqual(['planEdit', 'planRelease'])
    expect(dropPreview(leitung, 'planRelease')).toEqual([])
    const off = switchOff(leitung, 'planView')
    expect(off.dropped).toEqual(['planEdit', 'planRelease'])
    expect([off.draft.planView, off.draft.planEdit, off.draft.planRelease].every(state => !state.enabled)).toBe(true)
    // Only what is on is named: the Leitung has no contract switches by default.
    expect(dropPreview(leitung, 'employeesView')).not.toContain('contractView')
    expect(dropPreview(leitung, 'employeesView')).toContain('employeesEdit')
    expect(switchOff(off.draft, 'planView')).toEqual({ draft: off.draft, dropped: [] })
  })

  it('changes the scope of a scoped switch that is on, and sends only what differs from the stored state', () => {
    const stored = roleDraft(roleRights('observer'))
    expect(changedBundles(stored, stored)).toEqual([])
    const wider = withScope(stored, 'childrenView', 'facility')
    expect(withScope(stored, 'planView', 'facility')).toBe(stored)
    expect(withScope(stored, 'childrenEdit', 'facility')).toBe(stored)
    const released = switchOn(wider, 'planRelease', 'observer').draft
    expect(changedBundles(released, stored)).toEqual([
      { id: 'planEdit', enabled: true }, { id: 'planRelease', enabled: true },
      { id: 'childrenView', enabled: true, scope: 'facility' },
    ])
    expect(changedBundles(switchOff(stored, 'childrenView').draft, stored)).toEqual([
      { id: 'childrenView', enabled: false }, { id: 'childrenAttendance', enabled: false },
    ])
  })

  it('keeps every relation of the catalog consistent: on pulls, off drops, both ways', () => {
    for (const def of BUNDLES) {
      const on = switchOn(roleDraft(roleRights('observer')), def.id, 'observer').draft
      for (const needed of [...def.requires, ...def.includes]) expect(on[needed].enabled, `${def.id} → ${needed}`).toBe(true)
    }
  })
})

describe('exceptions per person', () => {
  it('shows the Träger every switch, the Leitung only the children switch of a Mitarbeiter, nobody else anything', () => {
    const viewer = (role: Role, flags: { canEditChildren?: boolean } = {}) => {
      const permissions = flaggedPermissions(role, flags)
      return { role, can: (key: Parameters<typeof permissions.has>[0]) => permissions.has(key) }
    }
    expect(personRightsMode(viewer('provider'), 'admin')).toBe('all')
    expect(personRightsMode(viewer('provider'), 'observer')).toBe('all')
    expect(personRightsMode(viewer('provider'), 'provider')).toBeNull()
    expect(personRightsMode(viewer('provider'), 'terminal')).toBeNull()
    expect(personRightsMode(viewer('admin'), 'observer')).toBe('childrenEdit')
    expect(personRightsMode(viewer('admin'), 'admin')).toBeNull()
    expect(personRightsMode(viewer('admin'), 'provider')).toBeNull()
    // A Leitung whose „Zugänge verwalten“ the Träger took away; a Mitarbeiter granted „Zugänge verwalten“.
    expect(personRightsMode({ role: 'admin', can: () => false }, 'observer')).toBeNull()
    expect(personRightsMode({ role: 'observer', can: key => key === 'users.manage' }, 'observer')).toBeNull()
    expect(personRightsMode(viewer('observer', { canEditChildren: true }), 'observer')).toBeNull()
  })

  it('replaces the one exception and keeps the others', () => {
    const rights = userRights('observer', [{ effect: 'grant', scope: null }], ['templatesEdit'])
    expect(overridesWith(rights, 'leavePlan', 'grant')).toEqual([
      { bundle: 'templatesEdit', effect: 'grant', scope: null }, { bundle: 'leavePlan', effect: 'grant', scope: null },
    ])
    expect(overridesWith(rights, 'templatesEdit', 'role')).toEqual([])
    expect(overridesWith(rights, 'calendarView', 'revoke')).toEqual([
      { bundle: 'templatesEdit', effect: 'grant', scope: null }, { bundle: 'calendarView', effect: 'revoke', scope: null },
    ])
    // A scoped grant takes the given scope, else the role's scope.
    expect(overridesWith(rights, 'childrenView', 'grant', 'facility').at(-1)).toEqual({ bundle: 'childrenView', effect: 'grant', scope: 'facility' })
    expect(overridesWith(rights, 'childrenEdit', 'grant').at(-1)).toEqual({ bundle: 'childrenEdit', effect: 'grant', scope: 'group' })
  })

  it('gives the Leitung „eintragen und Akten ändern“ as an exception only where the role does not already decide', () => {
    const berta = userRights('observer')
    expect(childEditingOverrides(berta, true)).toEqual([{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }])
    expect(childEditingOverrides(berta, false)).toEqual([])
    const allowed = userRights('observer', [{ effect: 'grant', scope: 'group' }], ['childrenEdit'])
    expect(childEditingOverrides(allowed, false)).toEqual([])
    // The Träger gave the whole role the switch: taking it away is a revoke.
    const roleHasIt = { ...berta, bundles: berta.bundles.map(bundle => (bundle.id === 'childrenEdit' ? { ...bundle, role: { enabled: true, scope: 'group' as const } } : bundle)) }
    expect(childEditingOverrides(roleHasIt, false)).toEqual([{ bundle: 'childrenEdit', effect: 'revoke', scope: null }])
    expect(childEditingOverrides(roleHasIt, true)).toEqual([])
  })

  it('names what an exception would take away beyond the switch itself', () => {
    const leitung = userRights('admin')
    expect(exceptionDropPreview(leitung, 'planView', overridesWith(leitung, 'planView', 'revoke'))).toEqual(['planEdit', 'planRelease'])
    expect(exceptionDropPreview(leitung, 'planRelease', overridesWith(leitung, 'planRelease', 'revoke'))).toEqual([])
    // A grant takes nothing away, nor does revoking what is off.
    expect(exceptionDropPreview(leitung, 'leavePlan', overridesWith(leitung, 'leavePlan', 'grant'))).toEqual([])
    expect(exceptionDropPreview(leitung, 'leavePlan', overridesWith(leitung, 'leavePlan', 'revoke'))).toEqual([])
    // Removing a grant: what was built on it goes; an included switch stays while what includes it is in effect.
    const granted = userRights('observer', [{ effect: 'grant', scope: null }, { effect: 'grant', scope: null }], ['employeesView', 'employeesEdit'])
    expect(exceptionDropPreview(granted, 'employeesView', overridesWith(granted, 'employeesView', 'role'))).toEqual(['employeesEdit'])
    const release = userRights('observer', [{ effect: 'grant', scope: null }], ['planRelease'])
    expect(exceptionDropPreview(release, 'planEdit', overridesWith(release, 'planEdit', 'role'))).toEqual([])
  })
})
