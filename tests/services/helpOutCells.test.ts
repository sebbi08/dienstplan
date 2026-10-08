import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, entries, shiftTemplates, weekTemplateEntries } from '../../server/db/schema'
import { createClosure, deleteClosure } from '../../server/services/closures'
import { adoptShiftTimes, applyToCells, cellOwner, deleteEntry, updateEntryTimes } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { applyWeekTemplate, saveWeekTemplate } from '../../server/services/weekTemplates'
import type { EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// 2026-10-05 is a Monday.
const monday = '2026-10-05'
const tuesday = '2026-10-06'

describe('help-out cells (one day, one facility)', () => {
  let db: Db
  /** A: the home facility (facility 1). */
  let leitungA: SessionUser
  /** B: the facility Anna helps out in. */
  let krippe: number
  let leitungB: SessionUser
  /** C: a third facility. */
  let hort: number
  let leitungC: SessionUser
  let anna: number
  let lena: number
  let kim: number

  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    hort = addFacility(db, 'Hort')
    leitungA = addUser(db, 'leitung-a', 'admin')
    leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    leitungC = addUser(db, 'leitung-c', 'admin', null, hort)
    anna = addEmployee(db, 'Anna')
    lena = addEmployee(db, 'Lena')
    kim = addEmployee(db, 'Kim', { facilityId: krippe })
    addHelpOut(db, anna, krippe, 2026, 10)
  })

  const shiftIn = (facilityId: number, label = 'F1'): EntryInput => ({ kind: 'shift', templateId: templateId(db, label, facilityId) })
  const codeInput = (key: string, start?: number, end?: number): EntryInput => ({ kind: 'code', codeId: codeId(db, key), start, end })
  const write = (actor: SessionUser, facilityId: number, employeeId: number, date: string, input: EntryInput | null, mode: 'replace' | 'add' | 'clear' = 'replace') =>
    applyToCells(db, actor, facilityId, [{ employeeId, date }], mode, input)
  const day = (employeeId: number, date: string) => db.select().from(entries).where(eq(entries.employeeId, employeeId)).all()
    .filter(entry => entry.date === date)
  /** Anna helps out in B on Tuesday with an F1 of B. */
  const helpOutTuesday = () => write(leitungB, krippe, anna, tuesday, shiftIn(krippe))

  describe('writing in B (the helper column)', () => {
    it('writes shifts, VZ and breaks of B into a helper cell as B\'s entries', () => {
      write(leitungB, krippe, anna, tuesday, codeInput('prep_time', 450, 570))
      write(leitungB, krippe, anna, tuesday, shiftIn(krippe))
      write(leitungB, krippe, anna, tuesday, { kind: 'break', start: 660, end: 675 }, 'add')
      write(leitungB, krippe, anna, monday, { kind: 'special', start: 480, end: 720 })
      const written = [...day(anna, tuesday), ...day(anna, monday)]
      expect(written).toHaveLength(4)
      expect(written.every(entry => entry.helpFacilityId === krippe)).toBe(true)
      expect(cellOwner(db, anna, tuesday)).toBe(krippe)
      // B's own staff still get home entries.
      write(leitungB, krippe, kim, tuesday, shiftIn(krippe))
      expect(day(kim, tuesday).map(entry => entry.helpFacilityId)).toEqual([null])
      expect(cellOwner(db, kim, tuesday)).toBe('home')
      expect(cellOwner(db, lena, tuesday)).toBeNull()
    })

    it('refuses absence codes in a helper cell', () => {
      for (const key of ['vacation', 'sick', 'special_leave', 'training', 'school', 'holiday', 'closure_day', 'other']) {
        expect(errorCode(() => write(leitungB, krippe, anna, tuesday, codeInput(key)))).toBe('help_code_not_allowed')
      }
      // A mixed selection with own staff is refused as a whole.
      expect(errorCode(() => applyToCells(db, leitungB, krippe, [{ employeeId: kim, date: tuesday }, { employeeId: anna, date: tuesday }],
        'replace', codeInput('sick')))).toBe('help_code_not_allowed')
      expect(db.select().from(entries).all()).toEqual([])
    })

    it('refuses a day that belongs to another plan', () => {
      write(leitungA, 1, anna, monday, shiftIn(1))
      expect(errorCode(() => write(leitungB, krippe, anna, monday, shiftIn(krippe)))).toBe('cell_taken')
      expect(errorCode(() => write(leitungB, krippe, anna, monday, null, 'clear'))).toBe('cell_taken')
      expect(errorCode(() => write(leitungB, krippe, anna, monday, { kind: 'break', start: 900, end: 915 }, 'add'))).toBe('cell_taken')
      // A day helping out in a third facility is taken too.
      addHelpOut(db, anna, hort, 2026, 10)
      write(leitungC, hort, anna, tuesday, shiftIn(hort))
      expect(errorCode(() => write(leitungB, krippe, anna, tuesday, shiftIn(krippe)))).toBe('cell_taken')
      expect(day(anna, monday).map(entry => entry.helpFacilityId)).toEqual([null])
      expect(day(anna, tuesday).map(entry => entry.helpFacilityId)).toEqual([hort])
    })

    it('refuses someone who is neither staff nor a helper that month', () => {
      expect(errorCode(() => write(leitungB, krippe, lena, tuesday, shiftIn(krippe)))).toBe('employee_not_found')
      expect(errorCode(() => write(leitungB, krippe, anna, '2026-11-03', shiftIn(krippe)))).toBe('employee_not_found')
      expect(errorCode(() => write(leitungC, hort, anna, tuesday, shiftIn(hort)))).toBe('employee_not_found')
      expect(db.select().from(entries).all()).toEqual([])
    })

    it('clears its own helper cell', () => {
      helpOutTuesday()
      write(leitungB, krippe, anna, tuesday, null, 'clear')
      expect(day(anna, tuesday)).toEqual([])
    })
  })

  describe('writing in A on a help-out day', () => {
    it('refuses anything but an absence and keeps B\'s entry', () => {
      helpOutTuesday()
      expect(errorCode(() => write(leitungA, 1, anna, tuesday, shiftIn(1)))).toBe('cell_helps_elsewhere')
      expect(errorCode(() => write(leitungA, 1, anna, tuesday, shiftIn(1), 'add'))).toBe('cell_helps_elsewhere')
      expect(errorCode(() => write(leitungA, 1, anna, tuesday, codeInput('prep_time', 450, 570)))).toBe('cell_helps_elsewhere')
      expect(errorCode(() => write(leitungA, 1, anna, tuesday, { kind: 'special', start: 480, end: 720 }))).toBe('cell_helps_elsewhere')
      expect(errorCode(() => write(leitungA, 1, anna, tuesday, null, 'clear'))).toBe('cell_helps_elsewhere')
      expect(day(anna, tuesday).map(entry => [entry.kind, entry.helpFacilityId])).toEqual([['shift', krippe]])
    })

    it('replaces the help-out with an absence and logs the change in both facilities', () => {
      releaseMonth(db, leitungA, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      releaseMonth(db, leitungB, krippe, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      helpOutTuesday()
      write(leitungA, 1, anna, tuesday, codeInput('sick'))
      expect(loadEntries(db, { employeeId: anna, from: tuesday, to: tuesday }).map(entry => [entry.codeKey, entry.helpFacilityId]))
        .toEqual([['sick', null]])
      expect(cellOwner(db, anna, tuesday)).toBe('home')
      const log = (facilityId: number) => db.select().from(changeLog).where(eq(changeLog.facilityId, facilityId)).all()
        .filter(row => row.date === tuesday && row.employeeId === anna)
      expect(log(krippe).at(-1)).toMatchObject({ before: 'F1 7:00–13:15', after: '—' })
      expect(log(1)).toHaveLength(1)
      expect(log(1)[0]).toMatchObject({ after: 'Krank' })
    })

    it('a timed absence such as Fortbildung with times replaces the help-out too', () => {
      helpOutTuesday()
      write(leitungA, 1, anna, tuesday, codeInput('training', 480, 900), 'add')
      expect(day(anna, tuesday).map(entry => [entry.absenceCodeId, entry.helpFacilityId])).toEqual([[codeId(db, 'training'), null]])
    })
  })

  describe('changing entries by id', () => {
    it('lets only the plan that owns an entry delete it or change its times', () => {
      helpOutTuesday()
      write(leitungA, 1, anna, monday, shiftIn(1))
      const helpEntry = day(anna, tuesday)[0]!.id
      const homeEntry = day(anna, monday)[0]!.id
      const times = { start: 480, end: 780, breakStart: null, breakEnd: null }
      expect(errorCode(() => deleteEntry(db, leitungA, 1, helpEntry))).toBe('entry_not_found')
      expect(errorCode(() => updateEntryTimes(db, leitungA, 1, helpEntry, times))).toBe('entry_not_found')
      expect(errorCode(() => deleteEntry(db, leitungB, krippe, homeEntry))).toBe('entry_not_found')
      expect(errorCode(() => updateEntryTimes(db, leitungB, krippe, homeEntry, times))).toBe('entry_not_found')
      expect(errorCode(() => deleteEntry(db, leitungC, hort, helpEntry))).toBe('entry_not_found')
      expect(db.select().from(entries).all()).toHaveLength(2)

      updateEntryTimes(db, leitungB, krippe, helpEntry, times)
      expect(day(anna, tuesday)[0]).toMatchObject({ start: 480, end: 780, kind: 'special', helpFacilityId: krippe })
      deleteEntry(db, leitungB, krippe, helpEntry)
      updateEntryTimes(db, leitungA, 1, homeEntry, times)
      deleteEntry(db, leitungA, 1, homeEntry)
      expect(db.select().from(entries).all()).toEqual([])
    })

    it('adopts new service times for the helper\'s shifts in B', () => {
      helpOutTuesday()
      write(leitungB, krippe, kim, tuesday, shiftIn(krippe))
      write(leitungA, 1, anna, monday, shiftIn(1))
      const f1 = db.select().from(shiftTemplates).where(eq(shiftTemplates.id, templateId(db, 'F1', krippe))).get()!
      const oldTimes = { start: f1.start, end: f1.end, breakStart: f1.breakStart, breakEnd: f1.breakEnd }
      const newTimes = { ...oldTimes, start: f1.start + 15 }
      expect(adoptShiftTimes(db, leitungB, krippe, f1.id, oldTimes, newTimes, '2026-10-01')).toEqual({ updated: 2, skipped: 0 })
      expect(day(anna, tuesday)[0]).toMatchObject({ start: f1.start + 15, helpFacilityId: krippe })
      expect(day(anna, monday)[0]).toMatchObject({ start: oldTimes.start })
    })
  })

  describe('closures', () => {
    it('a closure in A skips the help-out day, and deleting it keeps the help-out', () => {
      helpOutTuesday()
      const closure = createClosure(db, leitungA, 1, { startDate: monday, endDate: '2026-10-07', label: 'Herbst', mode: 'closure_day' })
      expect(loadEntries(db, { employeeId: anna, from: monday, to: '2026-10-07' }).map(entry => [entry.date, entry.codeKey ?? entry.shortLabel]))
        .toEqual([[monday, 'closure_day'], [tuesday, 'F1'], ['2026-10-07', 'closure_day']])
      deleteClosure(db, leitungA, 1, closure.id)
      expect(loadEntries(db, { employeeId: anna, from: monday, to: '2026-10-07' }).map(entry => [entry.date, entry.helpFacilityId]))
        .toEqual([[tuesday, krippe]])
    })

    it('a leave closure in A books leave only on the remaining days', () => {
      helpOutTuesday()
      createClosure(db, leitungA, 1, { startDate: monday, endDate: '2026-10-07', label: 'Herbst', mode: 'vacation' })
      expect(loadEntries(db, { employeeId: anna, from: monday, to: '2026-10-07', codeKey: 'vacation' }).map(entry => entry.date))
        .toEqual([monday, '2026-10-07'])
      expect(day(anna, tuesday).map(entry => entry.helpFacilityId)).toEqual([krippe])
    })
  })

  describe('week templates', () => {
    it('saving in B ignores the helper', () => {
      helpOutTuesday()
      write(leitungB, krippe, kim, monday, shiftIn(krippe))
      const template = saveWeekTemplate(db, krippe, { name: 'Woche', weekStart: monday })
      expect(template.rows.map(row => row.employeeId)).toEqual([kim])
      expect(db.select().from(weekTemplateEntries).all().map(row => row.employeeId)).toEqual([kim])
    })

    it('saving in A ignores its employee\'s help-out days in B', () => {
      helpOutTuesday()
      write(leitungA, 1, anna, monday, shiftIn(1))
      saveWeekTemplate(db, 1, { name: 'Woche', weekStart: monday })
      expect(db.select().from(weekTemplateEntries).all().map(row => [row.employeeId, row.weekday, row.shiftTemplateId]))
        .toEqual([[anna, 0, templateId(db, 'F1', 1)]])
    })

    it('applying in A skips the help-out day', () => {
      const nextWeek = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
      applyToCells(db, leitungA, 1, nextWeek.map(date => ({ employeeId: anna, date })), 'replace', shiftIn(1))
      const template = saveWeekTemplate(db, 1, { name: 'Woche', weekStart: '2026-10-12' })
      helpOutTuesday()
      expect(applyWeekTemplate(db, leitungA, 1, template.id, monday)).toEqual({ filled: 4, skipped: 1 })
      expect(day(anna, tuesday).map(entry => [entry.shiftTemplateId, entry.helpFacilityId])).toEqual([[templateId(db, 'F1', krippe), krippe]])
      expect(day(anna, monday).map(entry => entry.helpFacilityId)).toEqual([null])
    })

    it('applying in B writes only B\'s own staff', () => {
      write(leitungB, krippe, kim, '2026-10-12', shiftIn(krippe))
      const template = saveWeekTemplate(db, krippe, { name: 'Woche', weekStart: '2026-10-12' })
      expect(applyWeekTemplate(db, leitungB, krippe, template.id, monday)).toEqual({ filled: 1, skipped: 0 })
      expect(db.select().from(entries).all().filter(entry => entry.date === monday).map(entry => entry.employeeId)).toEqual([kim])
    })
  })
})
