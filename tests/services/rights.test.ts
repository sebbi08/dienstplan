import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, roleBundles, userBundleOverrides } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getActiveUser } from '../../server/services/auth'
import { accountPermissions, roleBundleRows } from '../../server/services/permissions'
import {
  getRights, getUserRights, resetRoleRights, rightsRole, saveRoleRights, saveUserRights,
} from '../../server/services/rights'
import { tabletChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { groupRightOf } from '../../server/lib/childViewer'
import { setPin } from '../../server/services/terminal'
import { updateUser } from '../../server/services/users'
import { BUNDLE_IDS, BUNDLES } from '../../shared/domain/permissionBundles'
import { PERMISSIONS, ROLE_DEFAULTS } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const NOW = new Date('2026-10-06T06:00:00Z')
const sorted = (keys: Iterable<string>) => [...keys].sort()

describe('rights API (Rechte und Rollen Teil 2)', () => {
  let db: Db
  let traeger: SessionUser
  let leitung: SessionUser
  let anna: SessionUser
  let ben: SessionUser
  let annaEmployee: number
  /** The account as the next request loads it (permissions fresh from the database). */
  const fresh = (user: SessionUser) => getActiveUser(db, user.id)!
  const overrides = (user: SessionUser) => db.select().from(userBundleOverrides).all()
    .filter(row => row.userId === user.id).map(row => [row.bundle, row.effect, row.scope]).sort()

  beforeEach(() => {
    db = createTestDb()
    traeger = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin')
    annaEmployee = addEmployee(db, 'Anna')
    anna = addUser(db, 'anna', 'observer', annaEmployee)
    ben = addUser(db, 'ben', 'observer', addEmployee(db, 'Ben'))
  })

  describe('catalog', () => {
    it('lists every switch with requires and includes, the Träger-only rights, and the three roles at the Grundeinstellung', () => {
      const rights = getRights(db)
      expect(rights.bundles.map(bundle => bundle.id)).toEqual([...BUNDLE_IDS])
      expect(rights.bundles.find(bundle => bundle.id === 'planRelease')).toMatchObject({ requires: [], includes: ['planEdit'] })
      expect(rights.bundles.find(bundle => bundle.id === 'childrenEdit')).toMatchObject({ scoped: true, requires: ['childrenView'] })
      expect(rights.areas[0]).toEqual({ id: 'plan', label: 'Dienstplan' })
      expect(rights.providerOnly.map(entry => entry.key)).toEqual(PERMISSIONS.filter(p => p.providerOnly).map(p => p.key))
      expect(rights.roles.map(role => [role.role, role.isDefault])).toEqual([['admin', true], ['group_lead', true], ['observer', true]])
      const observer = rights.roles.find(role => role.role === 'observer')!
      expect(observer.bundles.find(bundle => bundle.id === 'childrenView')).toEqual({
        id: 'childrenView', enabled: true, scope: 'group', defaultEnabled: true, defaultScope: 'group',
      })
    })

    it('knows only Leitung and Mitarbeiter as roles of the page', () => {
      expect(rightsRole('admin')).toBe('admin')
      expect(errorCode(() => rightsRole('provider'))).toBe('role_not_found')
      expect(errorCode(() => rightsRole('terminal'))).toBe('role_not_found')
    })
  })

  describe('role settings (RF2, RF3)', () => {
    it('affect every account of the role on its next request, and reset brings the Grundeinstellung back', () => {
      saveRoleRights(db, 'observer', [{ id: 'templatesEdit', enabled: true }])
      for (const user of [anna, ben]) expect(fresh(user).permissions.has('printTemplates.edit')).toBe(true)
      expect(fresh(leitung).permissions.has('printTemplates.edit')).toBe(true)
      saveRoleRights(db, 'admin', [{ id: 'cashBook', enabled: false }])
      expect(fresh(leitung).permissions.has('cash.view')).toBe(false)
      expect(fresh(leitung).permissions.has('cash.reopen')).toBe(false)
      const reset = resetRoleRights(db, 'observer')
      expect(reset.isDefault).toBe(true)
      expect(sorted(fresh(anna).permissions)).toEqual(sorted(ROLE_DEFAULTS.observer))
      expect(roleBundleRows(db, 'observer')).toEqual([])
    })

    it('pull in what a switched-on bundle needs or includes, and say so', () => {
      const saved = saveRoleRights(db, 'observer', [{ id: 'planRelease', enabled: true }])
      expect(saved.pulledIn).toEqual(['planEdit'])
      expect(saved.bundles.filter(bundle => bundle.enabled && !bundle.defaultEnabled).map(bundle => bundle.id))
        .toEqual(['planEdit', 'planRelease'])
      const contract = saveRoleRights(db, 'observer', [{ id: 'contractEdit', enabled: true }])
      expect(contract.pulledIn).toEqual(['employeesView', 'contractView'])
      expect(fresh(anna).permissions.has('employees.contractEdit')).toBe(true)
    })

    it('drop what needs a switched-off bundle, and say so', () => {
      const saved = saveRoleRights(db, 'admin', [{ id: 'employeesView', enabled: false }])
      expect(saved.dropped).toEqual([
        'leavePlan', 'timeManage', 'employeesEdit', 'contractView', 'contractEdit', 'employeesDelete', 'talksManage',
        'personal', 'payrollSensitive', 'docsQualifications', 'docsOther',
      ].filter(id => saved.bundles.find(bundle => bundle.id === id)!.defaultEnabled))
      const stored = roleBundleRows(db, 'admin')
      expect(stored.every(row => !row.enabled)).toBe(true)
      expect(fresh(leitung).permissions.has('employees.edit')).toBe(false)
      // Dropping the included bundle drops the including one.
      expect(saveRoleRights(db, 'admin', [{ id: 'planEdit', enabled: false }]).dropped).toEqual(['planRelease'])
    })

    it('refuses a switch on that needs one switched off in the same request', () => {
      expect(errorCode(() => saveRoleRights(db, 'observer', [
        { id: 'planEdit', enabled: true }, { id: 'planView', enabled: false },
      ]))).toBe('conflicting_bundles')
      expect(roleBundleRows(db, 'observer')).toEqual([])
    })

    it('never stores a Träger-only right, an unknown bundle or a bad scope (400, nothing stored)', () => {
      expect(errorCode(() => saveRoleRights(db, 'admin', [{ id: 'rights.manage', enabled: true }]))).toBe('provider_only_right')
      expect(errorCode(() => saveRoleRights(db, 'admin', [{ id: 'settings.staffing', enabled: true }]))).toBe('provider_only_right')
      expect(errorCode(() => saveRoleRights(db, 'admin', [{ id: 'everything', enabled: true }]))).toBe('unknown_bundle')
      expect(errorCode(() => saveRoleRights(db, 'admin', [{ id: 'childrenView', enabled: true, scope: 'world' }]))).toBe('invalid_scope')
      expect(errorCode(() => saveRoleRights(db, 'admin', [{ id: 'planView', enabled: true }, { id: 'planView', enabled: false }])))
        .toBe('duplicate_bundle')
      expect(db.select().from(roleBundles).all()).toEqual([])
    })

    it('stores only what differs from the Grundeinstellung, with the scope of the children bundles', () => {
      const saved = saveRoleRights(db, 'observer', BUNDLES.map(def => ({
        id: def.id, enabled: ROLE_DEFAULTS.observer.some(key => def.keys.includes(key)),
      })))
      expect(saved.isDefault).toBe(true)
      expect(roleBundleRows(db, 'observer')).toEqual([])
      saveRoleRights(db, 'observer', [{ id: 'childrenView', enabled: true, scope: 'facility' }])
      expect(roleBundleRows(db, 'observer')).toEqual([{ bundle: 'childrenView', enabled: true, scope: 'facility' }])
      expect(getRights(db).roles.find(role => role.role === 'observer')!.isDefault).toBe(false)
    })
  })

  describe('exceptions per person (RF2, RF3)', () => {
    it('override the role both ways, for that person only', () => {
      saveUserRights(db, traeger, anna.id, [{ bundle: 'templatesEdit', effect: 'grant' }])
      saveUserRights(db, traeger, leitung.id, [{ bundle: 'cashBook', effect: 'revoke' }])
      expect(fresh(anna).permissions.has('printTemplates.edit')).toBe(true)
      expect(fresh(ben).permissions.has('printTemplates.edit')).toBe(false)
      expect(fresh(leitung).permissions.has('cash.view')).toBe(false)
      const state = getUserRights(db, traeger, leitung.id).bundles.find(bundle => bundle.id === 'cashBook')!
      expect(state).toEqual({
        id: 'cashBook', role: { enabled: true, scope: null }, override: { effect: 'revoke', scope: null },
        effective: { enabled: false, scope: null },
      })
    })

    it('pull in what a granted bundle needs and drop what needs a revoked one', () => {
      const granted = saveUserRights(db, traeger, anna.id, [{ bundle: 'childrenManage', effect: 'grant' }])
      expect(granted.pulledIn).toEqual(['childrenEdit'])
      expect(overrides(anna)).toEqual([['childrenEdit', 'grant', 'group'], ['childrenManage', 'grant', null]])
      expect(fresh(anna).permissions.has('children.manage')).toBe(true)
      const revoked = saveUserRights(db, traeger, leitung.id, [{ bundle: 'cashBook', effect: 'revoke' }])
      expect(revoked.dropped).toEqual(['cashClose'])
      expect(overrides(leitung)).toEqual([['cashBook', 'revoke', null], ['cashClose', 'revoke', null]])
    })

    it('replace the whole list: an exception left out is removed', () => {
      saveUserRights(db, traeger, anna.id, [{ bundle: 'templatesEdit', effect: 'grant' }])
      saveUserRights(db, traeger, anna.id, [])
      expect(overrides(anna)).toEqual([])
      expect(fresh(anna).permissions.has('printTemplates.edit')).toBe(false)
    })

    it('never store a Träger-only right, an unknown bundle or effect (400)', () => {
      expect(errorCode(() => saveUserRights(db, traeger, anna.id, [{ bundle: 'backup.download', effect: 'grant' }]))).toBe('provider_only_right')
      expect(errorCode(() => saveUserRights(db, traeger, anna.id, [{ bundle: 'nonsense', effect: 'grant' }]))).toBe('unknown_bundle')
      expect(errorCode(() => saveUserRights(db, traeger, anna.id, [{ bundle: 'planView', effect: 'maybe' }]))).toBe('invalid_effect')
      expect(errorCode(() => saveUserRights(db, traeger, traeger.id, []))).toBe('no_rights_role')
      expect(overrides(anna)).toEqual([])
    })

    it('stay with the account when its role changes (they are the person\'s)', () => {
      saveUserRights(db, traeger, anna.id, [{ bundle: 'templatesEdit', effect: 'grant' }, { bundle: 'planView', effect: 'revoke' }])
      updateUser(db, traeger, anna.id, { role: 'admin', employeeId: annaEmployee, active: true })
      expect(overrides(anna)).toEqual([['planView', 'revoke', null], ['templatesEdit', 'grant', null]])
      expect(fresh(anna).permissions.has('plan.view')).toBe(false)
    })

    it('give a pulled-in children switch the widest scope of the switches that pull it', () => {
      saveRoleRights(db, 'observer', [{ id: 'childrenView', enabled: false }])
      const both = saveRoleRights(db, 'observer', [
        { id: 'childrenAttendance', enabled: true, scope: 'group' }, { id: 'childrenEdit', enabled: true, scope: 'facility' },
      ])
      expect(both.pulledIn).toEqual(['childrenView'])
      expect(both.bundles.find(bundle => bundle.id === 'childrenView')).toMatchObject({ enabled: true, scope: 'facility' })
      resetRoleRights(db, 'observer')
      saveRoleRights(db, 'observer', [{ id: 'childrenView', enabled: false }])
      saveUserRights(db, traeger, anna.id, [
        { bundle: 'childrenAttendance', effect: 'grant', scope: 'facility' }, { bundle: 'childrenEdit', effect: 'grant', scope: 'group' },
      ])
      expect(overrides(anna)).toContainEqual(['childrenView', 'grant', 'facility'])
      resetRoleRights(db, 'observer')
      saveUserRights(db, traeger, anna.id, [])
    })

    it('give a pulled-in children switch the scope of the switch that pulled it', () => {
      saveRoleRights(db, 'observer', [{ id: 'childrenView', enabled: false }])
      const role = saveRoleRights(db, 'observer', [{ id: 'childrenEdit', enabled: true, scope: 'facility' }])
      expect(role.pulledIn).toEqual(['childrenView'])
      expect(role.bundles.find(bundle => bundle.id === 'childrenView')).toMatchObject({ enabled: true, scope: 'facility' })
      resetRoleRights(db, 'observer')
      saveRoleRights(db, 'observer', [{ id: 'childrenView', enabled: false }])
      saveUserRights(db, traeger, anna.id, [{ bundle: 'childrenAttendance', effect: 'grant', scope: 'facility' }])
      expect(overrides(anna)).toEqual([['childrenAttendance', 'grant', 'facility'], ['childrenView', 'grant', 'facility']])
    })
  })

  describe('the Leitung (RF4)', () => {
    it('may allow and take away „eintragen und Akten ändern“ for a Mitarbeiter of its facility', () => {
      expect(getUserRights(db, leitung, anna.id).editable).toEqual(['childrenEdit'])
      saveUserRights(db, leitung, anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }])
      expect(fresh(anna).permissions.has('children.edit')).toBe(true)
      saveUserRights(db, leitung, anna.id, [])
      expect(fresh(anna).permissions.has('children.edit')).toBe(false)
      // With the role giving it, the Leitung takes it away with a revoke.
      saveRoleRights(db, 'observer', [{ id: 'childrenEdit', enabled: true }])
      saveUserRights(db, leitung, anna.id, [{ bundle: 'childrenEdit', effect: 'revoke' }])
      expect(fresh(anna).permissions.has('children.edit')).toBe(false)
      expect(fresh(ben).permissions.has('children.edit')).toBe(true)
    })

    it('keeps the other exceptions as they are, but changes nothing else (403)', () => {
      saveUserRights(db, traeger, anna.id, [{ bundle: 'templatesEdit', effect: 'grant' }])
      saveUserRights(db, leitung, anna.id, [{ bundle: 'templatesEdit', effect: 'grant' }, { bundle: 'childrenEdit', effect: 'grant' }])
      expect(overrides(anna)).toEqual([['childrenEdit', 'grant', 'group'], ['templatesEdit', 'grant', null]])
      for (const change of [
        [{ bundle: 'childrenEdit', effect: 'grant' }],
        [{ bundle: 'templatesEdit', effect: 'grant' }, { bundle: 'childrenEdit', effect: 'grant' }, { bundle: 'cashBook', effect: 'grant' }],
        [{ bundle: 'templatesEdit', effect: 'grant' }, { bundle: 'childrenEdit', effect: 'grant', scope: 'facility' }],
        // Granting children management would pull in more than the edit switch.
        [{ bundle: 'templatesEdit', effect: 'grant' }, { bundle: 'childrenEdit', effect: 'grant' }, { bundle: 'childrenManage', effect: 'grant' }],
      ]) {
        expect(errorCode(() => saveUserRights(db, leitung, anna.id, change)), JSON.stringify(change)).toBe('forbidden')
      }
      expect(overrides(anna)).toEqual([['childrenEdit', 'grant', 'group'], ['templatesEdit', 'grant', null]])
    })

    it('leaves an unchanged exception of the Träger alone and checks only a change of the edit switch', () => {
      // The Träger gave „eintragen und Akten ändern“ for the whole facility; the Leitung saves the list unchanged.
      saveUserRights(db, traeger, anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'facility' }])
      saveUserRights(db, leitung, anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'facility' }])
      expect(overrides(anna)).toEqual([['childrenEdit', 'grant', 'facility']])
      // Taking it away is hers; giving the whole facility again is not.
      saveUserRights(db, leitung, anna.id, [])
      expect(errorCode(() => saveUserRights(db, leitung, anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'facility' }])))
        .toBe('forbidden')
    })

    it('cannot take the edit switch away where the role builds on it: 403 rights_dependent_bundle', () => {
      saveRoleRights(db, 'observer', [{ id: 'childrenManage', enabled: true }])
      expect(errorCode(() => saveUserRights(db, leitung, anna.id, [{ bundle: 'childrenEdit', effect: 'revoke' }])))
        .toBe('rights_dependent_bundle')
      expect(overrides(anna)).toEqual([])
      // The Träger may, and the dependent switch goes with it.
      expect(saveUserRights(db, traeger, anna.id, [{ bundle: 'childrenEdit', effect: 'revoke' }]).dropped).toEqual(['childrenManage'])
    })

    it('is the only one besides the Träger: a Mitarbeiter with „Zugänge verwalten“ touches no rights (403)', () => {
      saveUserRights(db, traeger, anna.id, [{ bundle: 'usersManage', effect: 'grant' }])
      const manager = fresh(anna)
      expect(manager.permissions.has('users.manage')).toBe(true)
      // Not the edit switch of a colleague (it does not hold that right itself), not the own rights.
      expect(errorCode(() => saveUserRights(db, manager, ben.id, [{ bundle: 'childrenEdit', effect: 'grant' }]))).toBe('forbidden')
      expect(errorCode(() => getUserRights(db, manager, ben.id))).toBe('forbidden')
      expect(errorCode(() => saveUserRights(db, manager, anna.id, [
        { bundle: 'usersManage', effect: 'grant' }, { bundle: 'childrenEdit', effect: 'grant' },
      ]))).toBe('forbidden')
      expect(fresh(ben).permissions.has('children.edit')).toBe(false)
      expect(fresh(anna).permissions.has('children.edit')).toBe(false)
      // The Leitung never reaches its own account either.
      expect(errorCode(() => saveUserRights(db, leitung, leitung.id, []))).toBe('forbidden')
    })

    it('may not touch other accounts of its facility or Träger accounts (403), nor accounts of another facility (404)', () => {
      const tablet = addUser(db, 'tablet', 'terminal')
      const other = addUser(db, 'leitung2', 'admin')
      for (const target of [other, tablet, traeger, leitung]) {
        expect(errorCode(() => getUserRights(db, leitung, target.id)), target.username).toBe('forbidden')
        expect(errorCode(() => saveUserRights(db, leitung, target.id, [])), target.username).toBe('forbidden')
      }
      const krippe = addFacility(db, 'Krippe')
      const kim = addUser(db, 'kim', 'observer', addEmployee(db, 'Kim', { facilityId: krippe }))
      const leitungKrippe = addUser(db, 'leitungKrippe', 'admin', null, krippe)
      expect(errorCode(() => getUserRights(db, leitung, kim.id))).toBe('user_not_found')
      expect(errorCode(() => saveUserRights(db, leitung, kim.id, [{ bundle: 'childrenEdit', effect: 'grant' }]))).toBe('user_not_found')
      expect(errorCode(() => getUserRights(db, leitung, leitungKrippe.id))).toBe('user_not_found')
      expect(errorCode(() => getUserRights(db, leitung, 9999))).toBe('user_not_found')
      // The Träger reaches every facility.
      saveUserRights(db, traeger, kim.id, [{ bundle: 'childrenEdit', effect: 'grant' }])
      expect(accountPermissions(db, fresh(kim)).has('children.edit')).toBe(true)
    })
  })

  describe('scope at the tablet (RF2)', () => {
    let mice: number
    let bears: number
    beforeEach(() => {
      mice = addGroup(db, 1, 'Mäuse')
      bears = addGroup(db, 1, 'Bären')
      db.update(employees).set({ groupId: mice }).where(eq(employees.id, annaEmployee)).run()
      setTimeTrackingFrom(db, 1, '2026-10-01')
      setPin(db, 1, annaEmployee, '123456')
    })
    const tabletViewer = () => {
      const tablet = addUser(db, `tablet${Math.random()}`, 'terminal')
      const terminal = { id: tablet.id, facilityId: 1 }
      const { token } = unlockChildren(db, terminal, annaEmployee, '123456', NOW)
      return tabletChildViewer(db, terminal, token, NOW)
    }

    it('keeps a Mitarbeiter to the own group by default and gives all groups with „ganze Einrichtung“', () => {
      expect(tabletViewer().groups).toEqual({ own: mice, readable: [] })
      saveUserRights(db, traeger, anna.id, [
        { bundle: 'childrenView', effect: 'grant', scope: 'facility' },
        { bundle: 'childrenAttendance', effect: 'grant', scope: 'facility' },
      ])
      expect(tabletViewer().groups).toBeNull()
      saveUserRights(db, traeger, anna.id, [])
      saveRoleRights(db, 'observer', [
        { id: 'childrenView', enabled: true, scope: 'facility' }, { id: 'childrenAttendance', enabled: true, scope: 'facility' },
      ])
      expect(tabletViewer().groups).toBeNull()
      expect(bears).toBeGreaterThan(0)
    })

    it('takes the scope of every children switch on its own', () => {
      // „ansehen: ganze Einrichtung“, attendance own group: sees every group, writes attendance only in the own one.
      saveUserRights(db, traeger, anna.id, [{ bundle: 'childrenView', effect: 'grant', scope: 'facility' }])
      const viewer = tabletViewer()
      expect(viewer.groups).toBeNull()
      // (She holds no edit switch: that key follows „ansehen“ and is refused anyway.)
      expect(viewer.writeGroups).toEqual({ attendance: { own: mice, readable: [] }, edit: null })
      expect([groupRightOf(viewer, bears, 'children.view'), groupRightOf(viewer, bears, 'children.attendance')]).toEqual(['write', 'read'])
      expect(groupRightOf(viewer, mice, 'children.attendance')).toBe('write')
      // Editing for the whole facility, seeing only the own group: writes where it sees.
      saveUserRights(db, traeger, anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'facility' }])
      const editor = tabletViewer()
      expect(editor.groups).toEqual({ own: mice, readable: [] })
      expect(editor.writeGroups).toEqual({ attendance: { own: mice, readable: [] }, edit: null })
      expect([groupRightOf(editor, bears, 'children.edit'), groupRightOf(editor, mice, 'children.edit')]).toEqual(['none', 'write'])
    })

    it('gives a person with only a PIN the current Mitarbeiter role settings, not the defaults', () => {
      const carla = addEmployee(db, 'Carla', { groupId: mice })
      setPin(db, 1, carla, '654321')
      const tablet = addUser(db, 'tabletCarla', 'terminal')
      const terminal = { id: tablet.id, facilityId: 1 }
      const viewer = () => {
        const { token } = unlockChildren(db, terminal, carla, '654321', NOW)
        return tabletChildViewer(db, terminal, token, NOW)
      }
      expect(viewer()).toMatchObject({ id: null, groups: { own: mice, readable: [] } })
      expect(viewer().permissions.has('children.view')).toBe(true)
      saveRoleRights(db, 'observer', [
        { id: 'childrenView', enabled: true, scope: 'facility' }, { id: 'childrenAttendance', enabled: true, scope: 'facility' },
      ])
      expect(viewer().groups).toBeNull()
      saveRoleRights(db, 'observer', [{ id: 'childrenView', enabled: false }])
      const without = viewer()
      expect(without.permissions.has('children.view')).toBe(false)
      expect(without.permissions.has('children.attendance')).toBe(false)
      // Back to the Grundeinstellung at once.
      resetRoleRights(db, 'observer')
      expect(viewer().permissions.has('children.view')).toBe(true)
    })
  })

  it('the Leitung gives „eintragen und Akten ändern“ only while it holds it itself (403 rights_not_held)', () => {
    saveRoleRights(db, 'admin', [{ id: 'childrenEdit', enabled: false }])
    const weak = fresh(leitung)
    expect(weak.permissions.has('children.edit')).toBe(false)
    expect(errorCode(() => saveUserRights(db, weak, anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }])))
      .toBe('rights_not_held')
    expect(overrides(anna)).toEqual([])
    // Taking it away stays hers.
    saveUserRights(db, traeger, anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }])
    saveUserRights(db, weak, anna.id, [])
    expect(overrides(anna)).toEqual([])
    // With the right back the grant works again.
    resetRoleRights(db, 'admin')
    saveUserRights(db, fresh(leitung), anna.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }])
    expect(fresh(anna).permissions.has('children.edit')).toBe(true)
  })
})
