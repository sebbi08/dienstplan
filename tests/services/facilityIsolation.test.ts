import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, dayNotes, entries, monthPlans } from '../../server/db/schema'
import { isMonthReleased } from '../../server/services/changeLog'
import { createClosure, deleteClosure, listClosures } from '../../server/services/closures'
import { createEarlyClosure, deleteEarlyClosure, listEarlyClosures, updateEarlyClosure } from '../../server/services/earlyClosures'
import {
  addAdjustment, addHours, createEmployee, deleteAdjustment, deleteHours, getEmployee, listEmployees, moveEmployee,
  setContract, setEntitlement, setStampingOptions, updateEmployee,
} from '../../server/services/employees'
import { applyToCells, deleteEntry, setDayNote, updateEntryTimes } from '../../server/services/entries'
import { loadEmployees, loadEntries } from '../../server/services/queries'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-05'
const date = '2026-10-06'

describe('facility isolation', () => {
  let db: Db
  let facility2: number
  let anna: number
  let kim: number
  let leitungA: SessionUser
  let leitungB: SessionUser
  beforeEach(() => {
    db = createTestDb()
    facility2 = addFacility(db, 'Krippe')
    anna = addEmployee(db, 'Anna')
    kim = addEmployee(db, 'Kim', { facilityId: facility2 })
    leitungA = addUser(db, 'leitungA', 'admin')
    leitungB = addUser(db, 'leitungB', 'admin', null, facility2)
  })

  describe('employees, plan entries, day notes and closures (Task 3)', () => {
    it('lists only the facility\'s employees', () => {
      expect(listEmployees(db, 1, today, 'admin').map(e => e.name)).toEqual(['Anna'])
      expect(listEmployees(db, facility2, today, 'admin').map(e => e.name)).toEqual(['Kim'])
      expect(loadEmployees(db, 1).map(e => e.name)).toEqual(['Anna'])
      expect(loadEmployees(db).map(e => e.name)).toEqual(['Anna', 'Kim'])
      expect(errorCode(() => getEmployee(db, 1, kim, today, 'admin'))).toBe('employee_not_found')
      expect(getEmployee(db, facility2, kim, today, 'admin').name).toBe('Kim')
    })

    it('refuses changes to another facility\'s employee', () => {
      const update = { name: 'Kim', shortName: 'KI', leftOn: null }
      expect(errorCode(() => updateEmployee(db, 1, kim, update))).toBe('employee_not_found')
      expect(errorCode(() => addHours(db, 1, kim, { weeklyMinutes: 600, validFrom: '2026-10-01' }))).toBe('employee_not_found')
      expect(errorCode(() => addAdjustment(db, 1, kim, { date, minutes: 60, reason: 'x' }))).toBe('employee_not_found')
      expect(errorCode(() => setStampingOptions(db, 1, kim, { stampVia: 'tablet', breakMode: 'auto' }))).toBe('employee_not_found')
      const contract = { personnelNumber: null, employedSince: null, jobKey: null, jobOther: null, payGroup: null, payLevel: null }
      expect(errorCode(() => setContract(db, 1, kim, contract))).toBe('employee_not_found')
      addHours(db, facility2, kim, { weeklyMinutes: 600, validFrom: '2026-10-01' })
      const hoursId = getEmployee(db, facility2, kim, today, 'admin').hours[1]!.id
      expect(errorCode(() => deleteHours(db, 1, hoursId))).toBe('hours_not_found')
      expect(errorCode(() => moveEmployee(db, 1, kim, 'up'))).toBe('employee_not_found')
      expect(errorCode(() => setEntitlement(db, 1, kim, 2026, { days: 30, carriedOverDays: 0 }))).toBe('employee_not_found')
      addAdjustment(db, facility2, kim, { date, minutes: 60, reason: 'Übertrag' })
      const adjustmentId = getEmployee(db, facility2, kim, today, 'admin').adjustments[0]!.id
      deleteAdjustment(db, 1, adjustmentId)
      expect(getEmployee(db, facility2, kim, today, 'admin').adjustments).toHaveLength(1)
      deleteAdjustment(db, facility2, adjustmentId)
      expect(getEmployee(db, facility2, kim, today, 'admin').adjustments).toHaveLength(0)
    })

    it('refuses plan entries for another facility\'s employee', () => {
      const shift = { kind: 'shift' as const, templateId: templateId(db, 'M') }
      expect(errorCode(() => applyToCells(db, leitungA, 1, [{ employeeId: kim, date }], 'replace', shift))).toBe('employee_not_found')
      expect(loadEntries(db, { employeeId: kim })).toEqual([])
    })

    it('refuses a mixed batch as a whole', () => {
      const shift = { kind: 'shift' as const, templateId: templateId(db, 'M') }
      const cells = [{ employeeId: anna, date }, { employeeId: kim, date }]
      expect(errorCode(() => applyToCells(db, leitungA, 1, cells, 'replace', shift))).toBe('employee_not_found')
      expect(db.select().from(entries).all()).toEqual([])
    })

    it('keeps entries of another facility out of reach', () => {
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date }], 'replace', { kind: 'special', start: 480, end: 720 })
      const [entry] = loadEntries(db, { employeeId: kim })
      expect(errorCode(() => deleteEntry(db, leitungA, 1, entry!.id))).toBe('entry_not_found')
      expect(errorCode(() => updateEntryTimes(db, leitungA, 1, entry!.id, { start: 500, end: 720, breakStart: null, breakEnd: null })))
        .toBe('entry_not_found')
      expect(loadEntries(db, { facilityId: 1 })).toEqual([])
      expect(loadEntries(db, { facilityId: facility2 }).map(e => e.id)).toEqual([entry!.id])
    })

    it('logs changes only for the facility whose month is released', () => {
      db.insert(monthPlans).values({ facilityId: 1, year: 2026, month: 10, releasedAt: '2026-10-01T08:00:00.000Z' }).run()
      expect(isMonthReleased(db, 1, date)).toBe(true)
      expect(isMonthReleased(db, facility2, date)).toBe(false)
      const special = { kind: 'special' as const, start: 480, end: 720 }
      applyToCells(db, leitungA, 1, [{ employeeId: anna, date }], 'replace', special)
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date }], 'replace', special)
      setDayNote(db, leitungB, facility2, date, 'info2', 'Fototag')
      expect(db.select().from(changeLog).all().map(row => [row.facilityId, row.employeeId, row.field])).toEqual([[1, anna, 'entry']])
    })

    it('keeps day notes per facility', () => {
      setDayNote(db, leitungA, 1, date, 'info1', 'Ausflug')
      setDayNote(db, leitungB, facility2, date, 'info1', 'Elternabend')
      const notes = db.select().from(dayNotes).where(eq(dayNotes.date, date)).all()
      expect(notes.map(note => [note.facilityId, note.info1]).sort()).toEqual([[1, 'Ausflug'], [facility2, 'Elternabend']])
    })

    it('books closures only for the facility\'s staff', () => {
      const closure = createClosure(db, leitungA, 1, { startDate: date, endDate: date, label: 'Betriebsausflug', mode: 'closure_day' })
      expect(loadEntries(db, { from: date, to: date }).map(e => e.employeeId)).toEqual([anna])
      expect(errorCode(() => deleteClosure(db, leitungB, facility2, closure.id))).toBe('closure_not_found')
      expect(listClosures(db, 1).map(c => c.label)).toEqual(['Betriebsausflug'])
      expect(listClosures(db, facility2)).toEqual([])
      // A new employee of facility 2 does not get facility 1's closure.
      const lea = createEmployee(db, leitungB, facility2, { name: 'Lea', shortName: 'LE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      expect(loadEntries(db, { employeeId: lea })).toEqual([])
      expect(db.select().from(entries).where(and(eq(entries.employeeId, anna), eq(entries.absenceCodeId, codeId(db, 'closure_day')))).all())
        .toHaveLength(1)
    })

    it('early closures may share a date across facilities', () => {
      const first = createEarlyClosure(db, 1, { date, closedFrom: 780, reason: 'Wasserschaden' })
      createEarlyClosure(db, facility2, { date, closedFrom: 840, reason: 'Personalausfall' })
      expect(listEarlyClosures(db, 1, 2026).map(c => c.reason)).toEqual(['Wasserschaden'])
      expect(listEarlyClosures(db, facility2, 2026).map(c => c.reason)).toEqual(['Personalausfall'])
      expect(errorCode(() => updateEarlyClosure(db, facility2, first.id, { date, closedFrom: 800, reason: 'x' })))
        .toBe('early_closure_not_found')
      deleteEarlyClosure(db, facility2, first.id)
      expect(listEarlyClosures(db, 1, 2026)).toHaveLength(1)
      expect(errorCode(() => createEarlyClosure(db, 1, { date, closedFrom: 800, reason: 'x' }))).toBe('early_closure_exists')
    })

    it('creates employees in the given facility with their own sort order', () => {
      const lea = createEmployee(db, leitungB, facility2, { name: 'Lea', shortName: 'LE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      const ben = createEmployee(db, leitungA, 1, { name: 'Ben', shortName: 'BE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      expect(loadEmployees(db, facility2).map(e => [e.name, e.sortOrder])).toEqual([['Kim', 2], ['Lea', 3]])
      expect(listEmployees(db, 1, today, 'admin').map(e => e.id)).toEqual([anna, ben])
      const newFacility = addFacility(db, 'Hort')
      const first = createEmployee(db, leitungA, newFacility, { name: 'Tom', shortName: 'TO', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      expect(loadEmployees(db, newFacility).map(e => [e.id, e.sortOrder])).toEqual([[first, 1]])
      expect(lea).toBeGreaterThan(0)
    })
  })
})
