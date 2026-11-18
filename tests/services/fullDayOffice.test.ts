import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { createEmployee } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import type { ServiceError } from '../../server/lib/errors'
import { getMonthPlan } from '../../server/services/plan'
import { loadEmployees, loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { actualTimeFor, getTimeMonth, stamp } from '../../server/services/timeTracking'
import { computeDay } from '../../shared/domain/balance'
import type { ApplyMode, EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-06' // a Tuesday
const at = (iso: string) => new Date(iso) // UTC; October 2026 is CEST (UTC+2)

describe('Büro and Homeoffice for the whole day without times', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben', { weeklyHours: 20 })
  })
  const write = (input: EntryInput, mode: ApplyMode = 'replace', employeeId = anna, day = date) =>
    applyToCells(db, admin, 1, [{ employeeId, date: day }], mode, input)
  const office = (extra: Partial<EntryInput> = {}): EntryInput => ({ kind: 'code', codeId: codeId(db, 'office'), ...extra })
  const cellEntries = (employeeId = anna, day = date) => loadEntries(db, { employeeId, from: day, to: day })

  describe('input', () => {
    it('accepts a timed code without times, also as home office', () => {
      write(office())
      expect(cellEntries()).toMatchObject([{ codeKey: 'office', start: null, end: null, homeOffice: false, label: 'Büro (ganzer Tag)' }])
      write(office({ homeOffice: true }))
      expect(cellEntries()).toMatchObject([{ codeKey: 'office', start: null, end: null, homeOffice: true, label: 'Büro (ganzer Tag)' }])
      write({ kind: 'code', codeId: codeId(db, 'prep_time') }, 'replace', ben)
      expect(cellEntries(ben)).toMatchObject([{ codeKey: 'prep_time', start: null, label: 'VZ (ganzer Tag)' }])
    })
    it('keeps no break on a whole day and refuses a separate break in it', () => {
      write(office({ breakStart: 720, breakEnd: 750 }))
      expect(cellEntries()).toMatchObject([{ breakStart: null, breakEnd: null }])
      expect(errorCode(() => write({ kind: 'break', start: 720, end: 750 }, 'add'))).toBe('break_outside_work')
      expect(cellEntries()).toHaveLength(1)
    })
    it('still refuses home office on a full-day absence code', () => {
      expect(errorCode(() => write({ kind: 'code', codeId: codeId(db, 'sick'), homeOffice: true }))).toBe('home_office_not_allowed')
      expect(errorCode(() => write({ kind: 'code', codeId: codeId(db, 'vacation'), homeOffice: true }))).toBe('home_office_not_allowed')
      expect(cellEntries()).toEqual([])
    })
    it('replaces the duties of the cell', () => {
      write({ kind: 'shift', templateId: templateId(db, 'F1') }, 'add')
      write({ kind: 'code', codeId: codeId(db, 'prep_time'), start: 840, end: 960 }, 'add')
      write(office({ homeOffice: true }))
      expect(cellEntries().map(entry => entry.label)).toEqual(['Büro (ganzer Tag)'])
    })
    it('gives way to a duty added into its cell', () => {
      write(office())
      write({ kind: 'shift', templateId: templateId(db, 'F1') }, 'add')
      expect(cellEntries().map(entry => entry.kind)).toEqual(['shift'])
      write(office({ homeOffice: true }), 'replace', ben)
      write({ kind: 'code', codeId: codeId(db, 'office'), start: 480, end: 600 }, 'add', ben)
      expect(cellEntries(ben).map(entry => entry.label)).toEqual(['Büro 8:00–10:00'])
    })
    describe('on a day without daily target', () => {
      const refusal = (fn: () => unknown) => {
        try {
          fn()
        }
        catch (error) {
          const refused = error as ServiceError
          return [refused.statusCode, refused.code, refused.details]
        }
        return null
      }
      it('refuses a whole day on a weekend, a public holiday and a part-timer\'s day off, naming the cell', () => {
        const clara = createEmployee(db, admin, 1, { name: 'Clara', shortName: '', weeklyMinutes: 1200, validFrom: '2026-01-01', workdays: 0b00111 })
        const saturday = '2026-10-10'
        const christmas = '2026-12-25' // a Friday
        const thursday = '2026-10-08' // Clara works Monday to Wednesday
        expect(refusal(() => write(office(), 'replace', anna, saturday)))
          .toEqual([400, 'full_day_needs_target', { employeeId: anna, date: saturday, name: 'Anna' }])
        expect(refusal(() => write(office({ homeOffice: true }), 'replace', anna, christmas)))
          .toEqual([400, 'full_day_needs_target', { employeeId: anna, date: christmas, name: 'Anna' }])
        expect(refusal(() => write({ kind: 'code', codeId: codeId(db, 'prep_time') }, 'replace', clara, thursday)))
          .toEqual([400, 'full_day_needs_target', { employeeId: clara, date: thursday, name: 'Clara' }])
        expect(cellEntries(anna, saturday)).toEqual([])
        expect(cellEntries(anna, christmas)).toEqual([])
        expect(cellEntries(clara, thursday)).toEqual([])
      })
      it('still takes Büro with times on such a day', () => {
        write(office({ start: 480, end: 600 }), 'add', anna, '2026-10-10')
        expect(cellEntries(anna, '2026-10-10').map(entry => entry.label)).toEqual(['Büro 8:00–10:00'])
      })
      it('refuses the whole range and writes none of its cells', () => {
        write({ kind: 'shift', templateId: templateId(db, 'F1') }, 'add', anna, '2026-10-09')
        const cells = [{ employeeId: anna, date: '2026-10-09' }, { employeeId: anna, date: '2026-10-10' }]
        expect(refusal(() => applyToCells(db, admin, 1, cells, 'replace', office())))
          .toEqual([400, 'full_day_needs_target', { employeeId: anna, date: '2026-10-10', name: 'Anna' }])
        expect(cellEntries(anna, '2026-10-09').map(entry => entry.kind)).toEqual(['shift'])
      })
    })
    it('shows a whole day helping out elsewhere as „Dienst (ganzer Tag)“ in the home plan', () => {
      const other = addFacility(db, 'Sonnenschein')
      addHelpOut(db, anna, other, 2026, 10)
      applyToCells(db, addUser(db, 'leitung2', 'admin', null, other), other, [{ employeeId: anna, date }], 'replace', office())
      const home = getMonthPlan(db, admin, 1, 2026, 10, '2026-10-08').entries
        .filter(entry => entry.employeeId === anna && entry.date === date)
      expect(home.map(entry => entry.label)).toEqual(['Dienst (ganzer Tag)'])
    })
    it('names the whole day in the change log of a released month', () => {
      releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      write(office({ homeOffice: true }))
      expect(db.select().from(changeLog).all().at(-1)).toMatchObject({ before: '—', after: 'Büro (ganzer Tag) (Homeoffice)' })
    })
  })

  describe('balance and time tracking', () => {
    beforeEach(() => setTimeTrackingFrom(db, 1, '2026-10-01'))
    const today = '2026-10-08'
    const cellWarnings = (employeeId: number) => getMonthPlan(db, admin, 1, 2026, 10, today).admin!.warnings
      .filter(w => w.date === date && 'employeeId' in w && w.employeeId === employeeId).map(w => w.type)
    const credit = (employeeId: number) => {
      const employee = loadEmployees(db, 1).find(candidate => candidate.id === employeeId)!
      return computeDay(employee.info, date, cellEntries(employeeId), actualTimeFor(db, 1, today)(employeeId)).credit
    }
    const timeDay = (employeeId: number) => getTimeMonth(db, 1, employeeId, 2026, 10, today, 600).days.find(day => day.date === date)!

    it('credits the full daily target without a stamp and without a hint', () => {
      write(office())
      write(office({ homeOffice: true }), 'replace', ben)
      expect(credit(anna)).toBe(468)
      expect(credit(ben)).toBe(240)
      expect(cellWarnings(anna)).toEqual([])
      expect(cellWarnings(ben)).toEqual([])
    })
    it('ignores stamps on the day: no other credit, no stamp on an absence, no deviating „Ist“', () => {
      write(office())
      stamp(db, anna, 'in', 'self', at('2026-10-06T06:00:00Z')) // 8:00
      stamp(db, anna, 'out', 'self', at('2026-10-06T08:00:00Z')) // 10:00
      expect(credit(anna)).toBe(468)
      expect(cellWarnings(anna)).toEqual([])
      expect(getMonthPlan(db, admin, 1, 2026, 10, today).admin!.actuals[`${anna}|${date}`]).toMatchObject({ minutes: 120, deviates: false })
    })
    it('shows the whole day with the credited target on the time page', () => {
      write(office())
      write(office({ homeOffice: true }), 'replace', ben)
      expect(timeDay(anna)).toMatchObject({
        plan: 'Büro (ganzer Tag)', counted: 468, targetCredit: true, warnings: [], homeOffice: [],
        fullDay: { label: 'Büro (ganzer Tag)', homeOffice: false, minutes: 468 },
      })
      expect(timeDay(ben)).toMatchObject({
        plan: 'Büro (ganzer Tag) (Homeoffice)', counted: 240, targetCredit: true, warnings: [],
        fullDay: { label: 'Büro (ganzer Tag)', homeOffice: true, minutes: 240 },
      })
    })
    it('shows no whole day on a day with times', () => {
      write(office({ start: 480, end: 720 }))
      expect(timeDay(anna).fullDay).toBeNull()
    })
  })
})
