import { describe, expect, it } from 'vitest'
import type { PermissionKey } from '../../shared/domain/permissions'
import { accountLock, isManager, manageableRoles } from '../../shared/domain/roles'

const holding = (...keys: PermissionKey[]) => (key: PermissionKey) => keys.includes(key)

describe('manageableRoles and accountLock (the users page offers what the server allows)', () => {
  it('gives the Träger every role, the Leitung Leitung, Gruppenleitung, Mitarbeiter and tablet, anyone else the tablet only', () => {
    expect(manageableRoles('provider', holding('users.manage', 'users.providerAccounts')))
      .toEqual(['provider', 'admin', 'group_lead', 'observer', 'terminal'])
    expect(manageableRoles('admin', holding('users.manage'))).toEqual(['admin', 'group_lead', 'observer', 'terminal'])
    expect(manageableRoles('group_lead', holding('users.manage'))).toEqual(['terminal'])
    expect(manageableRoles('observer', holding('users.manage'))).toEqual(['terminal'])
  })

  it('locks the own account for everyone but the Träger, Träger accounts for non-Träger, other roles by manageableRoles', () => {
    const traeger = { id: 1, role: 'provider' as const }
    const leitung = { id: 2, role: 'admin' as const }
    const anna = { id: 3, role: 'observer' as const }
    const tablet = { id: 4, role: 'terminal' as const }
    const all = holding('users.manage', 'users.providerAccounts')
    const manage = holding('users.manage')
    expect([traeger, leitung, anna, tablet].map(account => accountLock(traeger, all, account))).toEqual([null, null, null, null])
    expect([traeger, leitung, anna, tablet].map(account => accountLock(leitung, manage, account))).toEqual(['provider', 'own', null, null])
    expect([traeger, leitung, anna, tablet].map(account => accountLock(anna, manage, account))).toEqual(['provider', 'role', 'own', null])
  })
})

// Who may edit child records is a right now (the bundle „eintragen und Akten ändern“, see permissionBundles.test.ts);
// the role only says who someone is.
describe('isManager', () => {
  it('names Träger and Leitung, nobody else', () => {
    expect(['provider', 'admin', 'observer', 'terminal', null, undefined].map(role => isManager(role as never)))
      .toEqual([true, true, false, false, false, false])
  })
})
