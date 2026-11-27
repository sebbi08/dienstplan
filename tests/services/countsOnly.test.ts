import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, terminalUnlocks, users } from '../../server/db/schema'
import { asChildPermission, type ChildViewer } from '../../server/lib/childViewer'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getActiveUser } from '../../server/services/auth'
import { autoEventsFor } from '../../server/services/autoEvents'
import { arrive, getAttendanceDay, leave, setAbsence, updateDay } from '../../server/services/childAttendance'
import { childCountsToday, getCountsOnly, setCountsOnly } from '../../server/services/countsOnly'
import { applyToCells } from '../../server/services/entries'
import { listMeals } from '../../server/services/meals'
import { accountsRights, saveBundleOverride } from '../../server/services/permissions'
import { getUserRights } from '../../server/services/rights'
import { getSetupChecklist, hideSetupItem } from '../../server/services/setupChecklist'
import {
  resolveChildViewer, tabletCountsFacility, tabletUnlockStatus, unlockChildren,
} from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { COUNTS_ONLY_OVERRIDES, countsOnlyApplies } from '../../shared/domain/countsOnly'
import { PERMISSION_KEYS, type PermissionKey } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import {
  addChild, addEmployee, addFacility, addGroup, addHelpOut, addUser, allowChildEditing, asChildViewer, createTestDb, errorCode,
  permissionsOf, templateId,
} from '../helpers/fixtures'

/** A moment in Berlin (summer time in October). */
const berlin = (date: string, time: string) => new Date(`${date}T${time}:00+02:00`)
const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const TODAY = '2026-10-14' // a Wednesday
const NOW = berlin(TODAY, '12:30')
const PIN = '123456'

/** Every key about children: what „Nur Kinderzahlen“ takes away (the child forms and Unfälle verwalten need children.view). */
const CHILD_KEYS = PERMISSION_KEYS.filter(key => key.startsWith('children.') || key.startsWith('childForms.') || key === 'accidents.manage')
const withoutChildKeys = (permissions: ReadonlySet<PermissionKey>) =>
  new Set([...permissions].filter(key => !CHILD_KEYS.includes(key) && key !== 'visits.manage' && key !== 'formTemplates.manage'))

describe('„Nur Kinderzahlen“', () => {
  let db: Db
  let tablet: SessionUser
  let leitung: SessionUser
  let traeger: SessionUser

  const flag = (employeeId: number, on = true) => db.update(employees).set({ countsOnly: on }).where(eq(employees.id, employeeId)).run()
  /** The tablet unlocked by the employee: its token. */
  function unlock(employeeId: number, now = NOW): string {
    setPin(db, 1, employeeId, PIN)
    return unlockChildren(db, { id: tablet.id, facilityId: 1 }, employeeId, PIN, now).token
  }
  const viewerAt = (token: string, now = NOW): ChildViewer => resolveChildViewer(db, tablet, token, now)
  const status = (token: string) => tabletUnlockStatus(db, { id: tablet.id, facilityId: 1 }, token, NOW)

  beforeEach(() => {
    db = createTestDb()
    setTimeTrackingFrom(db, 1, '2026-10-01')
    tablet = addUser(db, 'tablet', 'terminal')
    leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
    traeger = addUser(db, 'traeger', 'provider')
  })

  describe('who sets it (as „Kinder: eintragen und Akten ändern“)', () => {
    it('the Leitung for people of her facility without an account or with a Mitarbeiter account', () => {
      const hanna = addEmployee(db, 'Hanna')
      const mia = addEmployee(db, 'Mia')
      addUser(db, 'mia', 'observer', mia)
      expect(getCountsOnly(db, leitung, hanna)).toEqual({ countsOnly: false, offered: true, editable: true })
      expect(setCountsOnly(db, leitung, hanna, true)).toEqual({ countsOnly: true, offered: true, editable: true })
      expect(setCountsOnly(db, leitung, mia, true).countsOnly).toBe(true)
      expect(setCountsOnly(db, leitung, mia, false).countsOnly).toBe(false)
    })

    it('a Gruppenleitung\'s only the Träger: the Leitung sees it, cannot change it', () => {
      const gina = addEmployee(db, 'Gina')
      addUser(db, 'gina', 'group_lead', gina)
      expect(getCountsOnly(db, leitung, gina)).toEqual({ countsOnly: false, offered: true, editable: false })
      expect(errorCode(() => setCountsOnly(db, leitung, gina, true))).toBe('forbidden')
      expect(setCountsOnly(db, traeger, gina, true)).toEqual({ countsOnly: true, offered: true, editable: true })
      expect(getCountsOnly(db, leitung, gina).countsOnly).toBe(true)
    })

    it('not offered for a Leitung or Träger account (403 counts_only_manager)', () => {
      const dora = addEmployee(db, 'Dora')
      addUser(db, 'dora', 'admin', dora)
      const lea = db.select().from(employees).where(eq(employees.name, 'Lea Leitung')).get()!.id
      for (const actor of [leitung, traeger]) {
        expect(getCountsOnly(db, actor, dora)).toEqual({ countsOnly: false, offered: false, editable: false })
        expect(errorCode(() => setCountsOnly(db, actor, dora, true))).toBe('counts_only_manager')
      }
      expect(errorCode(() => setCountsOnly(db, leitung, lea, true))).toBe('counts_only_manager')
      expect(db.select().from(employees).where(eq(employees.id, dora)).get()!.countsOnly).toBe(false)
    })

    it('the Leitung not in another facility (404); the Träger in every facility', () => {
      const other = addFacility(db, 'Kita Zwei')
      const otto = addEmployee(db, 'Otto', { facilityId: other })
      expect(errorCode(() => getCountsOnly(db, leitung, otto))).toBe('employee_not_found')
      expect(errorCode(() => setCountsOnly(db, leitung, otto, true))).toBe('employee_not_found')
      expect(setCountsOnly(db, traeger, otto, true).countsOnly).toBe(true)
      expect(errorCode(() => getCountsOnly(db, traeger, 9999))).toBe('employee_not_found')
    })

    it('nobody else, not even a Mitarbeiter with „Zugänge verwalten“ (hidden, 403)', () => {
      const hanna = addEmployee(db, 'Hanna')
      const manager = { ...addUser(db, 'max', 'observer', addEmployee(db, 'Max')), permissions: new Set<PermissionKey>([...permissionsOf('observer'), 'users.manage']) }
      expect(getCountsOnly(db, manager, hanna)).toEqual({ countsOnly: false, offered: false, editable: false })
      expect(errorCode(() => setCountsOnly(db, manager, hanna, true))).toBe('forbidden')
      // Another facility's employee is unknown to them, as on the other employee routes.
      const otto = addEmployee(db, 'Otto', { facilityId: addFacility(db, 'Kita Zwei') })
      expect(errorCode(() => getCountsOnly(db, manager, otto))).toBe('employee_not_found')
      expect(errorCode(() => setCountsOnly(db, manager, otto, true))).toBe('employee_not_found')
    })

    it('a deactivated Leitung account counts as none: offered, and at the tablet the person has only the numbers', () => {
      const dora = addEmployee(db, 'Dora')
      const account = addUser(db, 'dora', 'admin', dora)
      expect(getCountsOnly(db, leitung, dora).offered).toBe(false)
      db.update(users).set({ active: false }).where(eq(users.id, account.id)).run()
      expect(getCountsOnly(db, leitung, dora)).toEqual({ countsOnly: false, offered: true, editable: true })
      expect(setCountsOnly(db, leitung, dora, true).countsOnly).toBe(true)
      const token = unlock(dora)
      expect(status(token)).toMatchObject({ unlocked: true, countsOnly: true })
      for (const key of CHILD_KEYS) expect(viewerAt(token).permissions.has(key), key).toBe(false)
      // Active again as Leitung: the stored flag has no effect and is no longer offered.
      db.update(users).set({ active: true }).where(eq(users.id, account.id)).run()
      expect(getCountsOnly(db, leitung, dora).offered).toBe(false)
      expect(status(token)).toMatchObject({ countsOnly: false })
      expect(viewerAt(token).permissions.has('children.view')).toBe(true)
    })
  })

  describe('the rights it leaves', () => {
    it('counts only for Gruppenleitung and Mitarbeiter (and people without an account)', () => {
      expect(countsOnlyApplies(true, 'observer')).toBe(true)
      expect(countsOnlyApplies(true, 'group_lead')).toBe(true)
      expect(countsOnlyApplies(true, 'admin')).toBe(false)
      expect(countsOnlyApplies(true, 'provider')).toBe(false)
      expect(countsOnlyApplies(false, 'observer')).toBe(false)
      expect(COUNTS_ONLY_OVERRIDES.every(override => override.effect === 'revoke')).toBe(true)
    })

    it('a person without an account at the tablet: no child right at all, everything else of the Mitarbeiter defaults', () => {
      const hanna = addEmployee(db, 'Hanna')
      flag(hanna)
      const viewer = viewerAt(unlock(hanna))
      for (const key of CHILD_KEYS) expect(viewer.permissions.has(key), key).toBe(false)
      expect(viewer.permissions).toEqual(withoutChildKeys(permissionsOf('observer')))
      for (const key of ['plan.view', 'time.own', 'leave.request', 'calendar.own', 'knowledge.view', 'contacts.view', 'notes.view', 'teamMeetings.write'] as const) {
        expect(viewer.permissions.has(key), key).toBe(true)
      }
    })

    it('wins over the account\'s exceptions and role, at the tablet and with the own account', () => {
      const mia = addEmployee(db, 'Mia')
      const account = addUser(db, 'mia', 'observer', mia)
      allowChildEditing(db, account.id)
      const gina = addEmployee(db, 'Gina')
      const lead = addUser(db, 'gina', 'group_lead', gina)
      flag(mia)
      flag(gina)
      for (const [employeeId, user] of [[mia, account], [gina, lead]] as const) {
        const viewer = viewerAt(unlock(employeeId))
        for (const key of CHILD_KEYS) expect(viewer.permissions.has(key), key).toBe(false)
        const office = getActiveUser(db, user.id, TODAY)!
        for (const key of CHILD_KEYS) expect(office.permissions.has(key), key).toBe(false)
        expect(errorCode(() => resolveChildViewer(db, office, undefined, NOW))).toBe('children_tablet_only')
        // The rest of the role stays.
        expect(office.permissions).toEqual(withoutChildKeys(permissionsOf(user.role)))
      }
      // The rights page shows the child switches off for the person (the effective state), the exception stays stored.
      const rights = getUserRights(db, traeger, account.id)
      expect(rights.bundles.find(bundle => bundle.id === 'childrenEdit')).toMatchObject({ override: { effect: 'grant' }, effective: { enabled: false } })
      expect(accountsRights(db, [{ id: account.id, role: 'observer', facilityId: 1 }]).get(account.id)!.permissions.has('children.view')).toBe(false)
    })

    it('wins over the strongest exceptions: „Kinder: ansehen“ and „auch mit eigenem Zugang“ granted', () => {
      const mia = addEmployee(db, 'Mia')
      const account = addUser(db, 'mia', 'observer', mia)
      saveBundleOverride(db, account.id, 'childrenView', 'grant', 'facility')
      saveBundleOverride(db, account.id, 'childrenOwnAccount', 'grant')
      expect(getActiveUser(db, account.id, TODAY)!.permissions.has('children.ownAccount')).toBe(true)
      flag(mia)
      const office = getActiveUser(db, account.id, TODAY)!
      for (const key of CHILD_KEYS) expect(office.permissions.has(key), key).toBe(false)
      expect(errorCode(() => resolveChildViewer(db, office, undefined, NOW))).toBe('children_tablet_only')
      const viewer = viewerAt(unlock(mia))
      for (const key of CHILD_KEYS) expect(viewer.permissions.has(key), key).toBe(false)
      const rights = getUserRights(db, traeger, account.id)
      for (const id of ['childrenView', 'childrenOwnAccount']) {
        expect(rights.bundles.find(bundle => bundle.id === id), id).toMatchObject({ override: { effect: 'grant' }, effective: { enabled: false } })
      }
    })

    it('a Gruppenleitung gets her child rights back when it is switched off', () => {
      const gina = addEmployee(db, 'Gina')
      const lead = addUser(db, 'gina', 'group_lead', gina)
      flag(gina)
      expect(getActiveUser(db, lead.id, TODAY)!.permissions.has('children.ownAccount')).toBe(false)
      flag(gina, false)
      expect(getActiveUser(db, lead.id, TODAY)!.permissions).toEqual(permissionsOf('group_lead'))
    })

    it('has no effect for a Leitung account (set before it became one)', () => {
      const lea = db.select().from(employees).where(eq(employees.name, 'Lea Leitung')).get()!.id
      flag(lea)
      expect(getActiveUser(db, leitung.id, TODAY)!.permissions).toEqual(leitung.permissions)
      const token = unlock(lea)
      expect(viewerAt(token).permissions).toEqual(leitung.permissions)
      expect(status(token)).toMatchObject({ unlocked: true, countsOnly: false })
    })

    it('holds for a helper from another facility as well', () => {
      const other = addFacility(db, 'Kita Zwei')
      const hugo = addEmployee(db, 'Hugo', { facilityId: other })
      addUser(db, 'hugo', 'observer', hugo)
      setTimeTrackingFrom(db, other, '2026-10-01')
      addHelpOut(db, hugo, 1, 2026, 10)
      applyToCells(db, leitung, 1, [{ employeeId: hugo, date: TODAY }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', 1) })
      setPin(db, other, hugo, PIN)
      const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, hugo, PIN, NOW).token
      expect(viewerAt(token).permissions.has('children.view')).toBe(true)
      flag(hugo)
      const viewer = viewerAt(token)
      for (const key of CHILD_KEYS) expect(viewer.permissions.has(key), key).toBe(false)
      expect(status(token)).toMatchObject({ countsOnly: true })
    })

    it('has no effect for a helper whose own account is a Leitung (flag set before the promotion)', () => {
      const other = addFacility(db, 'Kita Zwei')
      const hugo = addEmployee(db, 'Hugo', { facilityId: other })
      addUser(db, 'hugo', 'admin', hugo, other)
      setTimeTrackingFrom(db, other, '2026-10-01')
      addHelpOut(db, hugo, 1, 2026, 10)
      applyToCells(db, leitung, 1, [{ employeeId: hugo, date: TODAY }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', 1) })
      setPin(db, other, hugo, PIN)
      flag(hugo)
      const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, hugo, PIN, NOW).token
      // A helper works here with the Mitarbeiter role settings, the stored flag does not cut them.
      expect(status(token)).toMatchObject({ countsOnly: false })
      expect(viewerAt(token).permissions).toEqual(permissionsOf('observer'))
    })

    it('refuses every child guard at the tablet; the status says so and offers no child right', () => {
      const hanna = addEmployee(db, 'Hanna')
      flag(hanna)
      const token = unlock(hanna)
      const viewer = viewerAt(token)
      for (const key of CHILD_KEYS) expect(errorCode(() => asChildPermission(viewer, key)), key).toBe('forbidden')
      expect(status(token)).toMatchObject({
        unlocked: true, countsOnly: true,
        rights: { canEdit: false, isManager: false, canMoveFacility: false },
      })
      // Without the setting the same person reads the children as before.
      flag(hanna, false)
      expect(asChildPermission(viewerAt(token), 'children.view')).toBeTruthy()
      expect(status(token)).toMatchObject({ countsOnly: false })
    })
  })

  describe('outside the child routes', () => {
    it('„Was noch fehlt“ names no child to a counts-only Gruppenleitung with „Einstellungen der Einrichtung“', () => {
      addChild(db, 1, { firstName: 'Paula', lastName: 'Probe' })
      const gina = addEmployee(db, 'Gina')
      const lead = addUser(db, 'gina', 'group_lead', gina)
      saveBundleOverride(db, lead.id, 'settingsFacility', 'grant')
      const before = getActiveUser(db, lead.id, TODAY)!
      expect(getSetupChecklist(db, before, 1, NOW).open.find(item => item.key === 'child_care_type')!.names.map(entry => entry.name))
        .toEqual(['Paula Probe'])
      flag(gina)
      const office = getActiveUser(db, lead.id, TODAY)!
      expect(office.permissions.has('settings.facility')).toBe(true)
      expect(office.permissions.has('children.view')).toBe(false)
      const checklist = getSetupChecklist(db, office, 1, NOW)
      expect([...checklist.open, ...checklist.hidden].map(item => item.key)).not.toContain('child_care_type')
      expect(JSON.stringify(checklist)).not.toMatch(/Paula|Probe/)
      expect(errorCode(() => hideSetupItem(db, office, 1, 'child_care_type', NOW))).toBe('forbidden')
    })

    it('the plan\'s automatic events stay anonymous: group and count, never a child\'s name', () => {
      const bears = addGroup(db, 1, 'Bären')
      addChild(db, 1, { firstName: 'Paula', lastName: 'Probe', birthDate: '2022-10-14', groupId: bears })
      addChild(db, 1, { firstName: 'Ben', lastName: 'Beispiel', entryDate: '2026-10-15', groupId: bears })
      const events = Object.fromEntries(autoEventsFor(db, 1, '2026-10-01', '2026-10-31'))
      expect(events).toMatchObject({ '2026-10-14': ['Kindergeburtstag (Bären)'], '2026-10-15': ['Eingewöhnung (Bären)'] })
      expect(JSON.stringify(events)).not.toMatch(/Paula|Probe|Ben|Beispiel/)
    })
  })

  describe('„Kinder heute“', () => {
    let bears: number
    let mice: number
    let kids: number[]
    let office: ReturnType<typeof asChildViewer>
    const mealId = (name: string) => listMeals(db, 1, NOW).current.find(meal => meal.name === name)!.mealId

    beforeEach(() => {
      bears = addGroup(db, 1, 'Bären')
      mice = addGroup(db, 1, 'Mäuse')
      office = asChildViewer(leitung)
      kids = [
        addChild(db, 1, { groupId: bears, firstName: 'A' }), addChild(db, 1, { groupId: bears, firstName: 'B' }),
        addChild(db, 1, { groupId: mice, firstName: 'C' }), addChild(db, 1, { groupId: mice, firstName: 'D' }),
        addChild(db, 1, { groupId: null, firstName: 'E' }), addChild(db, 1, { groupId: bears, firstName: 'F' }),
      ]
      const at = (time: string) => berlin(TODAY, time)
      const [a, b, c, d, e] = kids as [number, number, number, number, number]
      // A here since 8:00 (until 15:00 planned), B here 8:00–11:00 (picked up before lunch), C absent (sick),
      // D here since 12:15 (lunch at 12:00 not counted, ticked by hand), E here since 9:00 without group, F not yet.
      arrive(db, office, { childId: a, date: TODAY, time: hm('08:00'), plannedPickup: hm('15:00') }, at('08:00'))
      arrive(db, office, { childId: b, date: TODAY, time: hm('08:00'), plannedPickup: hm('11:00') }, at('08:00'))
      leave(db, office, { childId: b, date: TODAY, time: hm('11:00'), pickup: { kind: 'other', name: 'Oma' } }, at('11:00'))
      setAbsence(db, office, { childId: c, from: TODAY, to: TODAY, kind: 'sick' }, at('08:00'))
      arrive(db, office, { childId: d, date: TODAY, time: hm('12:15'), plannedPickup: hm('16:00') }, at('12:15'))
      updateDay(db, office, { childId: d, date: TODAY, meals: { [mealId('Mittagessen')]: true } }, at('12:20'))
      arrive(db, office, { childId: e, date: TODAY, time: hm('09:00'), plannedPickup: hm('16:00') }, at('09:00'))
    })

    it('shows exactly the numbers of the attendance list, the meals and the groups included, without names or ids', () => {
      const list = getAttendanceDay(db, office, TODAY, NOW)
      const counts = childCountsToday(db, 1, NOW)
      expect(counts.total).toEqual({
        present: list.counts.present, notYet: list.counts.notYet, absent: list.counts.absent, gone: list.counts.gone,
        meals: list.meals.map(meal => list.counts.meals[meal.mealId]),
      })
      expect(counts.total).toMatchObject({ present: 3, notYet: 1, absent: 1, gone: 1 })
      expect(counts.meals).toEqual(list.meals.map(meal => ({ name: meal.name, time: meal.time })))
      expect(counts.meals.map(meal => meal.name)).toEqual(['Snack', 'Mittagessen'])
      // Snack 9:30: A, B, E; Mittagessen 12:00: A, E and D by hand (B was picked up at 11:00).
      expect(counts.total.meals).toEqual([3, 3])
      // Per group (Bären, Mäuse, without group) with the summary's meal counts.
      expect(counts.groups.map(group => group.name)).toEqual(['Bären', 'Mäuse', null])
      for (const [index, group] of counts.groups.entries()) {
        const summary = list.summary[index]!
        expect(group.meals).toEqual(list.meals.map(meal => summary.meals[meal.mealId]))
        expect(group.present + group.gone).toBe(summary.here)
      }
      expect(counts.groups[0]).toMatchObject({ present: 1, gone: 1, notYet: 1, absent: 0, meals: [2, 1] })
      expect(counts.groups[1]).toMatchObject({ present: 1, gone: 0, notYet: 0, absent: 1, meals: [0, 1] })
      expect(counts.groups[2]).toMatchObject({ present: 1, meals: [1, 1] })
      // Nothing about a child: only numbers, names of groups and meals.
      const text = JSON.stringify(counts)
      expect(text).not.toMatch(/childId|Muster|"id"/)
      expect(Object.keys(counts).sort()).toEqual(['date', 'groups', 'isCareDay', 'meals', 'total'])
    })

    it('leaves the groups out in a facility with one group', () => {
      const other = addFacility(db, 'Kita Zwei')
      addGroup(db, other, 'Alle')
      addChild(db, other, {})
      const counts = childCountsToday(db, other, NOW)
      expect(counts.groups).toEqual([])
      expect(counts.total).toMatchObject({ notYet: 1, present: 0 })
    })

    it('the tablet gives them only to a person with the setting, and reading is no use of the tablet', () => {
      const hanna = addEmployee(db, 'Hanna')
      const anna = addEmployee(db, 'Anna')
      flag(hanna)
      const terminal = { id: tablet.id, facilityId: 1 }
      const token = unlock(hanna)
      const before = db.select().from(terminalUnlocks).where(eq(terminalUnlocks.id, token)).get()!.lastActiveAt
      expect(tabletCountsFacility(db, terminal, token, berlin(TODAY, '12:31'))).toBe(1)
      expect(db.select().from(terminalUnlocks).where(eq(terminalUnlocks.id, token)).get()!.lastActiveAt).toBe(before)
      expect(errorCode(() => tabletCountsFacility(db, terminal, undefined, NOW))).toBe('tablet_locked')
      // Someone without the setting has the attendance list instead.
      expect(errorCode(() => tabletCountsFacility(db, terminal, unlock(anna), NOW))).toBe('forbidden')
    })
  })
})
