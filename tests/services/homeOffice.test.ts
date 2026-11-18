import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { setStampingOptions } from '../../server/services/employees'
import { adoptShiftTimes, applyToCells, updateEntryTimes } from '../../server/services/entries'
import { createTemplate, saveTemplateChange, updateTemplate, type TemplateInput } from '../../server/services/settings'
import { applyWeekTemplate, createWeekTemplate, getWeekTemplate } from '../../server/services/weekTemplates'
import { getMonthPlan } from '../../server/services/plan'
import { loadEmployees, loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { revertToRelease } from '../../server/services/revert'
import { getMyTime } from '../../server/services/myTime'
import { actualTimeFor, getTimeMonth, stamp } from '../../server/services/timeTracking'
import { computeDay, isOnSite } from '../../shared/domain/balance'
import type { EntryInput, SessionUser, TemplateDto } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-06'
const at = (iso: string) => new Date(iso) // UTC; October 2026 is CEST (UTC+2)

describe('home-office entries', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const add = (input: EntryInput, day = date) => applyToCells(db, admin, 1, [{ employeeId: anna, date: day }], 'add', input)
  const cellEntries = (day = date) => loadEntries(db, { employeeId: anna, from: day, to: day })

  describe('input', () => {
    it('stores the flag on special shifts, shifts and timed codes; false when not given', () => {
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      add({ kind: 'code', codeId: codeId(db, 'office'), start: 900, end: 960, homeOffice: true })
      add({ kind: 'shift', templateId: templateId(db, 'F1') })
      expect(cellEntries().map(entry => [entry.kind, entry.homeOffice])).toEqual([['shift', false], ['code', true], ['special', true]])
      add({ kind: 'shift', templateId: templateId(db, 'F1'), homeOffice: true }, '2026-10-07')
      expect(cellEntries('2026-10-07')[0]!.homeOffice).toBe(true)
    })
    it('refuses it on full-day codes, codes without working time and breaks', () => {
      const refused = (input: EntryInput, mode: 'add' | 'replace' = 'replace') =>
        errorCode(() => applyToCells(db, admin, 1, [{ employeeId: anna, date }], mode, { ...input, homeOffice: true }))
      expect(refused({ kind: 'code', codeId: codeId(db, 'sick') })).toBe('home_office_not_allowed')
      expect(refused({ kind: 'code', codeId: codeId(db, 'other'), start: 600, end: 660 })).toBe('home_office_not_allowed')
      add({ kind: 'special', start: 480, end: 720 })
      expect(refused({ kind: 'break', start: 600, end: 615 }, 'add')).toBe('home_office_not_allowed')
      expect(cellEntries()).toHaveLength(1)
    })
    it('is changed with the times of a single entry and kept when not given', () => {
      add({ kind: 'shift', templateId: templateId(db, 'M') })
      const id = cellEntries()[0]!.id
      updateEntryTimes(db, admin, 1, id, { start: 465, end: 960, breakStart: 700, breakEnd: 730, homeOffice: true })
      expect(cellEntries()[0]).toMatchObject({ kind: 'shift', homeOffice: true })
      updateEntryTimes(db, admin, 1, id, { start: 480, end: 960, breakStart: 700, breakEnd: 730 })
      expect(cellEntries()[0]).toMatchObject({ kind: 'special', homeOffice: true })
      updateEntryTimes(db, admin, 1, id, { start: 480, end: 960, breakStart: 700, breakEnd: 730, homeOffice: false })
      expect(cellEntries()[0]!.homeOffice).toBe(false)
    })
    it('refuses it when changing a break entry', () => {
      add({ kind: 'special', start: 480, end: 720 })
      add({ kind: 'break', start: 600, end: 615 })
      const breakId = cellEntries().find(entry => entry.kind === 'break')!.id
      expect(errorCode(() => updateEntryTimes(db, admin, 1, breakId, { start: 600, end: 615, breakStart: null, breakEnd: null, homeOffice: true })))
        .toBe('home_office_not_allowed')
    })
    it('names it in the change log of a released month', () => {
      releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      expect(db.select().from(changeLog).all().at(-1)).toMatchObject({ before: '—', after: '20:00–20:30 (Homeoffice)' })
      updateEntryTimes(db, admin, 1, cellEntries()[0]!.id, { start: 1200, end: 1230, breakStart: null, breakEnd: null, homeOffice: false })
      expect(db.select().from(changeLog).all().at(-1)).toMatchObject({ before: '20:00–20:30 (Homeoffice)', after: '20:00–20:30' })
    })
    it('restores it with the release', () => {
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      const id = cellEntries()[0]!.id
      updateEntryTimes(db, admin, 1, id, { start: 1200, end: 1230, breakStart: null, breakEnd: null, homeOffice: false })
      expect(revertToRelease(db, admin, 1, 2026, 10, [`${anna}|${date}`])).toBe(1)
      expect(cellEntries()[0]!.homeOffice).toBe(true)
    })
  })

  describe('time tracking', () => {
    beforeEach(() => setTimeTrackingFrom(db, 1, '2026-10-01'))
    const minutes = () => actualTimeFor(db, 1, '2026-10-08')(anna)!.minutesByDate.get(date)
    const warnings = () => getMonthPlan(db, admin, 1, 2026, 10, '2026-10-08').admin!.warnings
      .filter(w => w.date === date && 'employeeId' in w && w.employeeId === anna).map(w => w.type)

    it('counts a day with only home office as worked, without a missing record', () => {
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      expect(minutes()).toBe(30)
      const employee = loadEmployees(db, 1).find(candidate => candidate.id === anna)!
      const actual = actualTimeFor(db, 1, '2026-10-08')(anna)
      expect(computeDay(employee.info, date, cellEntries(), actual).credit).toBe(30)
      expect(warnings()).toEqual([])
    })
    it('adds home office to a separate stamp and counts overlapping minutes once', () => {
      add({ kind: 'shift', templateId: templateId(db, 'F1') }) // 7:00–13:15
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      stamp(db, anna, 'in', 'self', at('2026-10-06T05:00:00Z')) // 7:00
      stamp(db, anna, 'out', 'self', at('2026-10-06T11:30:00Z')) // 13:30
      expect(minutes()).toBe(390 + 30)
      updateEntryTimes(db, admin, 1, cellEntries().find(entry => entry.homeOffice)!.id,
        { start: 795, end: 855, breakStart: null, breakEnd: null })
      // 13:15–14:15 at home, but stamped until 13:30: that quarter hour counts once.
      expect(minutes()).toBe(390 + 45)
    })
    it('counts home office in the plan\'s „Ist“ of a stamped day, so it does not deviate', () => {
      add({ kind: 'shift', templateId: templateId(db, 'F1') }) // 7:00–13:15
      add({ kind: 'special', start: 1200, end: 1260, homeOffice: true })
      stamp(db, anna, 'in', 'self', at('2026-10-06T05:00:00Z'))
      stamp(db, anna, 'out', 'self', at('2026-10-06T11:15:00Z'))
      expect(getMonthPlan(db, admin, 1, 2026, 10, '2026-10-08').admin!.actuals[`${anna}|${date}`])
        .toMatchObject({ minutes: 375 + 60, deviates: false })
    })
    it('deducts a planned break inside the home office', () => {
      add({ kind: 'special', start: 480, end: 840, breakStart: 720, breakEnd: 750, homeOffice: true })
      setStampingOptions(db, 1, anna, { stampVia: 'both', breakMode: 'auto' })
      expect(minutes()).toBe(330)
    })
    it('still warns about a missing record for planned work at the facility', () => {
      add({ kind: 'shift', templateId: templateId(db, 'F1') })
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      expect(warnings()).toEqual(['missing_record'])
    })
    it('shows the home-office time on the time page and counts it', () => {
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      const day = getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08', 600).days.find(candidate => candidate.date === date)!
      expect(day).toMatchObject({
        homeOffice: [{ start: 1200, end: 1230 }], recordedMinutes: 30, counted: 30, plannedMinutes: 30, warnings: [],
      })
      expect(day.plan).toBe('20:00–20:30 (Homeoffice)')
    })
    it('counts home office as recorded only on days of the tracking range (not today, not later, not before it)', () => {
      setTimeTrackingFrom(db, 1, '2026-10-05')
      for (const day of ['2026-10-02', date, '2026-10-08', '2026-10-12']) add({ kind: 'special', start: 1200, end: 1230, homeOffice: true }, day)
      const days = getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08', 600).days
      const recorded = (day: string) => {
        const row = days.find(candidate => candidate.date === day)!
        return [row.usesRecords, row.homeOffice, row.recordedMinutes]
      }
      expect(recorded(date)).toEqual([true, [{ start: 1200, end: 1230 }], 30])
      for (const day of ['2026-10-02', '2026-10-08', '2026-10-12']) expect(recorded(day), day).toEqual([false, [], 0])
    })
    it('gives „Mein Dienstplan“ the same „Erfasst“ per day as the time page, home office included', () => {
      setTimeTrackingFrom(db, 1, '2026-10-05')
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true })
      add({ kind: 'special', start: 1200, end: 1230, homeOffice: true }, '2026-10-12')
      stamp(db, anna, 'in', 'self', at('2026-10-07T05:00:00Z'))
      stamp(db, anna, 'out', 'self', at('2026-10-07T11:00:00Z'))
      const mine = getMyTime(db, addUser(db, 'anna', 'observer', anna), 2026, 10, at('2026-10-08T08:00:00Z'))
      expect(mine.recordedDays).toEqual({
        [date]: { homeOffice: [{ start: 1200, end: 1230 }], recordedMinutes: 30 },
        '2026-10-07': { homeOffice: [], recordedMinutes: 360 },
      })
      const page = getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08', 600).days
      for (const [day, recorded] of Object.entries(mine.recordedDays)) {
        expect(page.find(candidate => candidate.date === day)!.recordedMinutes, day).toBe(recorded.recordedMinutes)
      }
    })
  })
})

describe('home-office shift buttons', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const cellEntries = (day = date) => loadEntries(db, { employeeId: anna, from: day, to: day })
  const enter = (id: number, day = date) => applyToCells(db, admin, 1, [{ employeeId: anna, date: day }], 'add', { kind: 'shift', templateId: id })
  const homeOfficeButton = () => createTemplate(db, 1, {
    shortLabel: 'HO', label: 'Homeoffice', start: 480, end: 720, breakStart: null, breakEnd: null,
    countsAsStaff: true, pairsWithPrepTime: false, homeOffice: true,
  })
  const asInput = (template: TemplateDto): TemplateInput => ({
    shortLabel: template.shortLabel, label: template.label, start: template.start, end: template.end,
    breakStart: template.breakStart, breakEnd: template.breakEnd, countsAsStaff: template.countsAsStaff,
    pairsWithPrepTime: template.pairsWithPrepTime, homeOffice: template.homeOffice,
  })

  it('creates a home-office entry that counts without stamping and is not on site', () => {
    setTimeTrackingFrom(db, 1, '2026-10-01')
    const button = homeOfficeButton()
    enter(button.id)
    const [entry] = cellEntries()
    expect(entry).toMatchObject({ kind: 'shift', homeOffice: true, start: 480, end: 720 })
    expect(isOnSite(entry!)).toBe(false)
    expect(actualTimeFor(db, 1, '2026-10-08')(anna)!.minutesByDate.get(date)).toBe(240)
  })
  it('lets an input that names the flag decide, and leaves normal buttons at false', () => {
    const button = homeOfficeButton()
    applyToCells(db, admin, 1, [{ employeeId: anna, date }], 'add', { kind: 'shift', templateId: button.id, homeOffice: false })
    enter(templateId(db, 'F1'), '2026-10-07')
    expect(cellEntries()[0]!.homeOffice).toBe(false)
    expect(cellEntries('2026-10-07')[0]!.homeOffice).toBe(false)
  })
  it('changing the flag on the button leaves existing entries alone', () => {
    const button = homeOfficeButton()
    enter(button.id)
    updateTemplate(db, 1, button.id, { ...asInput(button), homeOffice: false })
    expect(cellEntries()[0]!.homeOffice).toBe(true)
    enter(button.id, '2026-10-07')
    expect(cellEntries('2026-10-07')[0]!.homeOffice).toBe(false)
    updateTemplate(db, 1, button.id, { ...asInput(button), homeOffice: true })
    expect(cellEntries('2026-10-07')[0]!.homeOffice).toBe(false)
  })
  it('adopting new times keeps the home-office flag of the entries', () => {
    const button = homeOfficeButton()
    enter(button.id)
    const oldTimes = { start: 480, end: 720, breakStart: null, breakEnd: null }
    expect(adoptShiftTimes(db, admin, 1, button.id, oldTimes, { ...oldTimes, end: 750 }, '2026-10-01')).toEqual({ updated: 1, skipped: 0 })
    expect(cellEntries()[0]).toMatchObject({ end: 750, homeOffice: true })
  })
  it('saving a changed button with the adoption flow keeps the flag of the entries', () => {
    const button = homeOfficeButton()
    enter(button.id)
    saveTemplateChange(db, admin, 1, button.id, { ...asInput(button), end: 750, homeOffice: false }, '2026-10-01')
    expect(cellEntries()[0]).toMatchObject({ end: 750, homeOffice: true })
  })
  it('gives week template entries the flag, into the template and into the plan', () => {
    const button = homeOfficeButton()
    const made = createWeekTemplate(db, 1, { name: 'Woche', entries: [{ employeeId: anna, weekday: 0, kind: 'shift', templateId: button.id }] })
    expect(getWeekTemplate(db, 1, made.id).entries[0]).toMatchObject({ homeOffice: true })
    applyWeekTemplate(db, admin, 1, made.id, '2026-10-05')
    expect(cellEntries('2026-10-05')[0]).toMatchObject({ kind: 'shift', homeOffice: true })
  })
})
