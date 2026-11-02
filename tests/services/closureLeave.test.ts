import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createClosure, listClosures } from '../../server/services/closures'
import { createEmployee } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { setLeaveCounting } from '../../server/services/leaveCounting'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, templateId } from '../helpers/fixtures'

// 2026-05-01 (Friday) is a public holiday, 25 December a Friday, 26 December a Saturday.
const summer = { startDate: '2026-08-07', endDate: '2026-08-17', label: 'Sommerschließzeit', mode: 'vacation' as const }
const christmas = { startDate: '2026-12-21', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' as const }

describe('leave days of a closure', () => {
  let db: Db
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
  })

  describe('in the closures list (five-day week)', () => {
    it('counts the working days without weekends and public holidays', () => {
      createClosure(db, admin, 1, summer)
      createClosure(db, admin, 1, { startDate: '2026-04-27', endDate: '2026-05-01', label: 'Maiwoche', mode: 'vacation' })
      expect(listClosures(db, 1).map(closure => [closure.label, closure.leaveDays])).toEqual([['Maiwoche', 4], ['Sommerschließzeit', 7]])
    })
    it('uses no leave in closure-day mode', () => {
      createClosure(db, admin, 1, { ...summer, mode: 'closure_day' })
      expect(listClosures(db, 1)[0]!.leaveDays).toBeNull()
    })
    it('counts 24 and 31 December by the facility setting', () => {
      createClosure(db, admin, 1, christmas)
      expect(listClosures(db, 1)[0]!.leaveDays).toBe(8)
      setLeaveCounting(db, 1, { christmasEveHalfLeave: true })
      expect(listClosures(db, 1)[0]!.leaveDays).toBe(7)
    })
  })

  describe('in a person\'s leave account', () => {
    const closuresOf = (employeeId: number, year = 2026) =>
      getLeaveAccount(db, employeeId, year, '2026-01-01').closures.map(row => [row.label, row.days, row.closureDays])

    it('lists each closure with the leave days it used', () => {
      const anna = addEmployee(db, 'Anna')
      const closure = createClosure(db, admin, 1, summer)
      createClosure(db, admin, 1, christmas)
      expect(getLeaveAccount(db, anna, 2026, '2026-01-01').closures[0]).toEqual({
        closureId: closure.id, label: summer.label, startDate: summer.startDate, endDate: summer.endDate, days: 7, closureDays: 0,
      })
      expect(closuresOf(anna)).toEqual([['Sommerschließzeit', 7, 0], ['Weihnachten', 8, 0]])
    })
    it('counts only the person\'s working days', () => {
      const clara = createEmployee(db, admin, 1, { name: 'Clara', shortName: '', weeklyMinutes: 1200, validFrom: '2026-01-01', workdays: 0b00111 })
      createClosure(db, admin, 1, { startDate: '2026-08-10', endDate: '2026-08-14', label: 'Schließwoche', mode: 'vacation' })
      expect(closuresOf(clara)).toEqual([['Schließwoche', 3, 0]])
    })
    it('leaves out a day changed in the plan', () => {
      const anna = addEmployee(db, 'Anna')
      createClosure(db, admin, 1, summer)
      applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-08-10' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
      expect(closuresOf(anna)).toEqual([['Sommerschließzeit', 6, 0]])
    })
    it('shows the closure days of a joiner without leave left', () => {
      createClosure(db, admin, 1, summer)
      const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-08-01', vacationDays: 2 })
      expect(closuresOf(dora)).toEqual([['Sommerschließzeit', 2, 5]])
    })
    it('leaves out closures before the person started', () => {
      createClosure(db, admin, 1, { startDate: '2026-04-27', endDate: '2026-04-30', label: 'Frühling', mode: 'vacation' })
      createClosure(db, admin, 1, summer)
      const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-08-12', vacationDays: 30 })
      expect(closuresOf(dora)).toEqual([['Sommerschließzeit', 4, 0]])
    })
    it('leaves out closures in closure-day mode', () => {
      const anna = addEmployee(db, 'Anna')
      createClosure(db, admin, 1, { ...summer, mode: 'closure_day' })
      expect(closuresOf(anna)).toEqual([])
    })
    it('counts only the days of the year', () => {
      const anna = addEmployee(db, 'Anna')
      createClosure(db, admin, 1, { startDate: '2026-12-28', endDate: '2027-01-05', label: 'Jahreswechsel', mode: 'vacation' })
      expect(closuresOf(anna, 2026)).toEqual([['Jahreswechsel', 4, 0]])
      // 1 January is a public holiday, 2 and 3 January a weekend.
      expect(closuresOf(anna, 2027)).toEqual([['Jahreswechsel', 2, 0]])
    })
    it('counts 24 and 31 December by the facility setting', () => {
      const anna = addEmployee(db, 'Anna')
      setLeaveCounting(db, 1, { christmasEveHalfLeave: true })
      createClosure(db, admin, 1, christmas)
      expect(closuresOf(anna)).toEqual([['Weihnachten', 7, 0]])
    })
  })
})
