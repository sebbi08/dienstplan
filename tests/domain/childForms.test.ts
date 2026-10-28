import { describe, expect, it } from 'vitest'
import { canCreateChildForm, canManageChildForms, childFormRight } from '../../shared/domain/childForms'
import { effectivePermissions } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

const ANNA = 1
const BERTA = 2
const CARLA = 3

/** The viewer with the permissions of an account of the role (no flags). */
function viewer(over: Partial<{ role: Role; onTablet: boolean; employeeId: number | null; canSeeChild: boolean }> = {}) {
  const { role, ...rest } = { role: 'terminal' as Role, onTablet: true, employeeId: ANNA, canSeeChild: true, ...over }
  const permissions = effectivePermissions({ role, canEditChildren: false, isLeavePlanner: false, contractVisibleToAdmins: false })
  return { permissions, ...rest }
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

  it('never lets a non-manager outside the tablet see child forms', () => {
    expect(childFormRight(viewer({ role: 'observer', onTablet: false, employeeId: ANNA }), child, form, new Set([ANNA]))).toBe('none')
    expect(childFormRight(viewer({ role: 'observer', onTablet: false, employeeId: null }), child, null, none)).toBe('none')
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
  })
})
