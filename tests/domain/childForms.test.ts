import { describe, expect, it } from 'vitest'
import { canCreateChildForm, canManageChildForms, childFormRight } from '../../shared/domain/childForms'
import { effectivePermissions } from '../../shared/domain/permissionBundles'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

const ANNA = 1
const BERTA = 2
const CARLA = 3

type Over = Partial<{ role: Role; onTablet: boolean; employeeId: number | null; canSeeChild: boolean; ownGroup: boolean }>

/** The viewer with the permissions of an account of the role (no flags); by default of another group than the child. */
function viewer(over: Over = {}) {
  const { role, ...rest } = { role: 'terminal' as Role, onTablet: true, employeeId: ANNA, canSeeChild: true, ownGroup: false, ...over }
  const permissions = effectivePermissions({ role })
  return { permissions, ...rest }
}

/** The viewer with the role's permissions without „Bögen der eigenen Gruppe“ (the switch off for the role). */
function withoutGroupRight(over: Over = {}) {
  const base = viewer(over)
  const permissions: ReadonlySet<PermissionKey> = new Set([...base.permissions].filter(key => key !== 'childForms.group'))
  return { ...base, permissions }
}
const child = { keyEducatorId: ANNA }
const form = { id: 10 }
const none = new Set<number>()

describe('childFormRight', () => {
  it('gives nothing to a viewer who cannot see the child', () => {
    expect(childFormRight(viewer({ role: 'admin', onTablet: false, canSeeChild: false }), child, form, none)).toBe('none')
    expect(childFormRight(viewer({ role: 'provider', canSeeChild: false }), child, form, none)).toBe('none')
    expect(childFormRight(viewer({ canSeeChild: false }), child, form, new Set([ANNA]))).toBe('none')
  })

  it('lets managers edit in the office and at the tablet', () => {
    for (const role of ['provider', 'admin'] as const) {
      expect(childFormRight(viewer({ role, onTablet: false, employeeId: null }), child, form, none)).toBe('edit')
      expect(childFormRight(viewer({ role, onTablet: true, employeeId: null }), child, form, none)).toBe('edit')
      expect(childFormRight(viewer({ role, onTablet: true, employeeId: BERTA }), child, null, none)).toBe('edit')
    }
  })

  it('lets the key educator edit at the tablet', () => {
    expect(childFormRight(viewer({ employeeId: ANNA }), child, form, none)).toBe('edit')
    expect(childFormRight(viewer({ role: 'observer', employeeId: ANNA }), child, form, none)).toBe('edit')
  })

  it('gives a non-key educator read until unlocked for that form', () => {
    expect(childFormRight(viewer({ employeeId: BERTA }), child, form, none)).toBe('read')
    expect(childFormRight(viewer({ employeeId: BERTA }), child, form, new Set([BERTA]))).toBe('edit')
  })

  it('does not carry an unlock over to other forms or other employees', () => {
    const editorsOfForm10 = new Set([BERTA])
    // the caller passes the editors of the form being checked: for form 11 that set is empty
    expect(childFormRight(viewer({ employeeId: BERTA }), child, { id: 11 }, none)).toBe('read')
    expect(childFormRight(viewer({ employeeId: CARLA }), child, form, editorsOfForm10)).toBe('read')
  })

  it('moves the edit right with the key educator', () => {
    const moved = { keyEducatorId: BERTA }
    expect(childFormRight(viewer({ employeeId: ANNA }), moved, form, none)).toBe('read')
    expect(childFormRight(viewer({ employeeId: BERTA }), moved, form, none)).toBe('edit')
  })

  it('lets a viewer without employee only read', () => {
    expect(childFormRight(viewer({ employeeId: null }), child, form, none)).toBe('read')
    expect(childFormRight(viewer({ employeeId: null }), { keyEducatorId: null }, form, none)).toBe('read')
    expect(childFormRight(viewer({ employeeId: null }), child, form, new Set([ANNA]))).toBe('read')
  })

  it('gives no edit right when the child has no key educator', () => {
    expect(childFormRight(viewer({ employeeId: ANNA }), { keyEducatorId: null }, form, none)).toBe('read')
  })

  it('never lets a non-manager without children.ownAccount see child forms outside the tablet', () => {
    expect(childFormRight(viewer({ role: 'observer', onTablet: false, employeeId: ANNA }), child, form, new Set([ANNA]))).toBe('none')
    expect(childFormRight(viewer({ role: 'observer', onTablet: false, employeeId: null }), child, null, none)).toBe('none')
    expect(childFormRight(viewer({ role: 'observer', onTablet: false, employeeId: ANNA, ownGroup: true }), child, form, none)).toBe('none')
  })

  it('lets an account with children.ownAccount read the forms outside the tablet (key educator and unlocks count at the tablet)', () => {
    expect(childFormRight(withoutGroupRight({ role: 'group_lead', onTablet: false, employeeId: ANNA }), child, form, new Set([ANNA])))
      .toBe('read')
  })

  it('lets an employee with childForms.group edit the forms of a child of the own group, at the tablet and with the own account', () => {
    for (const role of ['observer', 'group_lead'] as const) {
      expect(childFormRight(viewer({ role, employeeId: BERTA, ownGroup: true }), child, form, none), role).toBe('edit')
      expect(childFormRight(viewer({ role, employeeId: BERTA, ownGroup: true }), child, null, none), role).toBe('edit')
      // A person without employee (an account at the tablet's defaults) as well: the group decides.
      expect(childFormRight(viewer({ role, employeeId: null, ownGroup: true }), child, form, none), role).toBe('edit')
    }
    // With the own account (children.ownAccount, the Gruppenleitung's default).
    expect(childFormRight(viewer({ role: 'group_lead', onTablet: false, employeeId: BERTA, ownGroup: true }), child, form, none)).toBe('edit')
  })

  it('leaves a child of another group to read (or to the key educator and the unlocked employees at the tablet)', () => {
    expect(childFormRight(viewer({ role: 'observer', employeeId: BERTA }), child, form, none)).toBe('read')
    expect(childFormRight(viewer({ role: 'observer', employeeId: BERTA }), child, form, new Set([BERTA]))).toBe('edit')
    expect(childFormRight(viewer({ role: 'observer', employeeId: ANNA }), child, form, none)).toBe('edit')
    expect(childFormRight(viewer({ role: 'group_lead', onTablet: false, employeeId: BERTA }), child, form, none)).toBe('read')
  })

  it('is the rule of before when the role has the switch off', () => {
    expect(childFormRight(withoutGroupRight({ role: 'observer', employeeId: BERTA, ownGroup: true }), child, form, none)).toBe('read')
    expect(childFormRight(withoutGroupRight({ role: 'observer', employeeId: ANNA, ownGroup: true }), child, form, none)).toBe('edit')
    expect(childFormRight(withoutGroupRight({ role: 'observer', employeeId: BERTA, ownGroup: true }), child, form, new Set([BERTA])))
      .toBe('edit')
    expect(childFormRight(withoutGroupRight({ role: 'group_lead', onTablet: false, employeeId: BERTA, ownGroup: true }), child, form, none))
      .toBe('read')
  })

  it('ignores editors for a form-less check', () => {
    expect(childFormRight(viewer({ employeeId: BERTA }), child, null, new Set([BERTA]))).toBe('read')
    expect(childFormRight(viewer({ employeeId: ANNA }), child, null, none)).toBe('edit')
  })
})

describe('canCreateChildForm', () => {
  it('allows managers anywhere', () => {
    expect(canCreateChildForm(viewer({ role: 'admin', onTablet: false, employeeId: null }), child)).toBe(true)
    expect(canCreateChildForm(viewer({ role: 'provider', employeeId: BERTA }), child)).toBe(true)
  })

  it('allows the key educator at the tablet only', () => {
    expect(canCreateChildForm(viewer({ employeeId: ANNA }), child)).toBe(true)
    expect(canCreateChildForm(viewer({ employeeId: BERTA }), child)).toBe(false)
    expect(canCreateChildForm(viewer({ employeeId: null }), child)).toBe(false)
    expect(canCreateChildForm(viewer({ employeeId: null }), { keyEducatorId: null })).toBe(false)
    expect(canCreateChildForm(viewer({ role: 'observer', onTablet: false, employeeId: ANNA }), child)).toBe(false)
  })

  it('allows an employee with childForms.group for a child of the own group, at the tablet and with the own account', () => {
    expect(canCreateChildForm(viewer({ role: 'observer', employeeId: BERTA, ownGroup: true }), child)).toBe(true)
    expect(canCreateChildForm(viewer({ role: 'observer', employeeId: null, ownGroup: true }), { keyEducatorId: null })).toBe(true)
    expect(canCreateChildForm(viewer({ role: 'group_lead', onTablet: false, employeeId: BERTA, ownGroup: true }), child)).toBe(true)
    // Another group's child: only the key educator at the tablet, as before.
    expect(canCreateChildForm(viewer({ role: 'observer', employeeId: BERTA }), child)).toBe(false)
    expect(canCreateChildForm(viewer({ role: 'group_lead', onTablet: false, employeeId: ANNA }), child)).toBe(false)
    // Without children.ownAccount nothing outside the tablet; with the switch off the rule of before.
    expect(canCreateChildForm(viewer({ role: 'observer', onTablet: false, employeeId: BERTA, ownGroup: true }), child)).toBe(false)
    expect(canCreateChildForm(withoutGroupRight({ role: 'observer', employeeId: BERTA, ownGroup: true }), child)).toBe(false)
    expect(canCreateChildForm(withoutGroupRight({ role: 'observer', employeeId: ANNA, ownGroup: true }), child)).toBe(true)
  })

  it('denies everybody who cannot see the child', () => {
    expect(canCreateChildForm(viewer({ role: 'admin', canSeeChild: false }), child)).toBe(false)
    expect(canCreateChildForm(viewer({ canSeeChild: false }), child)).toBe(false)
  })
})

describe('canManageChildForms', () => {
  it('is for managers only', () => {
    expect(canManageChildForms(viewer({ role: 'admin', onTablet: false }))).toBe(true)
    expect(canManageChildForms(viewer({ role: 'provider' }))).toBe(true)
    expect(canManageChildForms(viewer({ role: 'terminal' }))).toBe(false)
    expect(canManageChildForms(viewer({ role: 'observer' }))).toBe(false)
    expect(canManageChildForms(viewer({ role: 'group_lead', ownGroup: true }))).toBe(false)
  })
})
