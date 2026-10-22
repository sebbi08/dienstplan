import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import type { Db } from '../../server/db/client'
import { childGroupChanges, employees, entries, facilities, groups } from '../../server/db/schema'
import { createCareType } from '../../server/services/careTypes'
import { createClosure } from '../../server/services/closures'
import { setFacilityOpeningHours, setGroupOpeningHours } from '../../server/services/openingHours'
import { getMonthPlan } from '../../server/services/plan'
import { staffingMonth, staffingWarnings } from '../../server/services/staffingReport'
import { monthDates, weekday } from '../../shared/domain/dates'
import type { DayHours, OpeningHours } from '../../shared/domain/openingHours'
import type { Qualification } from '../../shared/domain/staffing/types'
import type { GermanState } from '../../shared/domain/states'
import { formatTime } from '../../shared/domain/time'
import type { Warning } from '../../shared/domain/warnings'
import type { SessionUser, StaffingRowDto } from '../../shared/types/api'
import {
  addChild, addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb,
} from '../helpers/fixtures'

const NOW = '2026-10-01T08:00:00.000Z'
const TODAY = '2026-10-01'
// October 2026: 22 weekdays, no public holiday on a weekday in BW.
const TUESDAY = '2026-10-06'
const WEDNESDAY = '2026-10-07'
const WEEKDAYS = monthDates(2026, 10).filter(date => weekday(date) < 5)
/** 7.8 h = the daily target of 39 h a week. */
const FULL_DAY = [420, 888] as const

let db: Db
let admin: SessionUser
let bears: number
let mice: number

beforeEach(() => {
  db = createTestDb()
  admin = addUser(db, 'leitung', 'admin')
  bears = addGroup(db, 1, 'Bären')
  mice = addGroup(db, 1, 'Mäuse')
})

const setType = (groupId: number, groupType: string | null) =>
  db.update(groups).set({ groupType }).where(eq(groups.id, groupId)).run()
const setState = (state: GermanState, facilityId = 1) =>
  db.update(facilities).set({ state }).where(eq(facilities.id, facilityId)).run()
const careType = (name: string, start: number, end: number, daysPerWeek = 5) =>
  createCareType(db, 1, { name, start, end, sortOrder: 0, daysPerWeek }).id

function staff(name: string, qualification: Qualification | null, options: {
  groupId?: number | null; share?: number | null; facilityId?: number
} = {}): number {
  const id = addEmployee(db, name, { groupId: options.groupId ?? null, facilityId: options.facilityId ?? 1 })
  db.update(employees).set({ qualification, staffingShare: options.share ?? null }).where(eq(employees.id, id)).run()
  return id
}

/** A special duty without break; `extra` sets e.g. the entry group or the help-out facility. */
function duty(employeeId: number, date: string, start: number, end: number, extra: Partial<typeof entries.$inferInsert> = {}) {
  db.insert(entries).values({ employeeId, date, kind: 'special', start, end, countsAsStaff: true, updatedAt: NOW, ...extra }).run()
}
const everyWeekday = (employeeId: number, extra: Partial<typeof entries.$inferInsert> = {}) =>
  WEEKDAYS.forEach(date => duty(employeeId, date, FULL_DAY[0], FULL_DAY[1], extra))
function sickAllMonth(employeeId: number) {
  db.delete(entries).where(eq(entries.employeeId, employeeId)).run()
  for (const date of WEEKDAYS) {
    db.insert(entries).values({ employeeId, date, kind: 'code', absenceCodeId: codeId(db, 'sick'), countsAsStaff: false, updatedAt: NOW }).run()
  }
}

function children(count: number, groupId: number, careTypeId: number | null, birthDate = '2022-03-15'): number[] {
  return Array.from({ length: count }, (_, i) =>
    addChild(db, 1, { firstName: `K${i}`, lastName: `G${groupId}`, groupId, careTypeId, birthDate, entryDate: '2025-09-01' }))
}

const report = (year = 2026, month = 10) => staffingMonth(db, 1, year, month)
const row = (groupId: number | null, year = 2026, month = 10): StaffingRowDto =>
  report(year, month).groups.find(r => r.groupId === groupId)!

const none: DayHours = { open: null, close: null, closed: false }
const allWeek = (open: number, close: number): OpeningHours => ({
  days: [0, 1, 2, 3, 4].map(() => ({ open, close, closed: false })), minAtOpening: 1, minAtClosing: 1,
})
const staffingOf = (list: Warning[], date?: string) =>
  list.filter(w => w.type === 'staffing' && (date === undefined || w.date === date))
const planWarnings = () => getMonthPlan(db, admin, 1, 2026, 10, TODAY).admin!.warnings

describe('staffingMonth – Review Focus 1 (BW Regelgruppe)', () => {
  let anna: number
  let berta: number
  beforeEach(() => {
    setType(bears, 'regel')
    children(25, bears, careType('Ganztag', 420, 900))
    anna = staff('Anna', 'fachkraft', { groupId: bears })
    berta = staff('Berta', 'fachkraft', { groupId: bears })
    const azubi = staff('Carl', 'azubi_2', { groupId: bears, share: 0 })
    for (const id of [anna, berta, azubi]) everyWeekday(id)
  })

  it('two full-time Fachkräfte and an Azubi at 0 % give Ist 2.0 against Soll 1.8: not red', () => {
    const bearsRow = row(bears)
    expect(bearsRow).toMatchObject({ name: 'Bären', groupType: 'regel', children: { total: 25, u3: 0 }, ok: true })
    expect(bearsRow.required.fte).toBeCloseTo(1.8, 9)
    expect(bearsRow.required.lines.find(l => l.key === 'demand')!.fte).toBeCloseTo(1.8, 9)
    expect(bearsRow.planned.fte).toBeCloseTo(2.0, 9)
    expect(bearsRow.planned.fachkraftFte).toBeCloseTo(2.0, 9)
    expect(bearsRow.diff).toBeCloseTo(0.2, 9)
    expect(bearsRow.staffWithoutQualification).toEqual([])
    expect(bearsRow.childrenWithoutCareType).toBe(0)
    expect(bearsRow.unmatchedChildren).toBe(0)
  })

  it('one Fachkraft absent all month: Ist 1.0, red', () => {
    sickAllMonth(berta)
    const bearsRow = row(bears)
    expect(bearsRow.planned.fte).toBeCloseTo(1.0, 9)
    expect(bearsRow.ok).toBe(false)
    expect(bearsRow.diff).toBeCloseTo(-0.8, 9)
  })

  it('carries the meta of the version valid on the first day of the month', () => {
    const { meta } = report()
    expect(meta).toMatchObject({ land: 'BW', confidence: 'high', periodCheck: true, fteHoursPerWeek: 39, careDays: 22 })
    expect(meta.validFrom).toBe('2025-07-14')
    expect(meta.source).toContain('KiTaVO BW')
    expect(meta.note).toContain('Schließtage')
  })

  it('scales the group demand with the average opening of the group on its care days', () => {
    setFacilityOpeningHours(db, 1, allWeek(420, 960)) // 9 h
    expect(row(bears).required.fte).toBeCloseTo(1.8 * 9 / 6, 9)
    // The group's own hours win; a weekday without own hours uses the facility's.
    setGroupOpeningHours(db, 1, bears, { days: [{ open: 420, close: 780, closed: false }, none, none, none, none], minAtOpening: 1, minAtClosing: 1 })
    // 4 Mondays at 6 h, 18 other days at 9 h.
    expect(row(bears).required.fte).toBeCloseTo(1.8 * ((4 * 6 + 18 * 9) / 22) / 6, 9)
  })

  it('closure days reduce the weeks of the month, so full-time stays 1.0', () => {
    // Books Urlaub for the staff on the closure days (replacing their duties).
    createClosure(db, admin, 1, { startDate: '2026-10-26', endDate: '2026-10-30', label: 'Herbst', mode: 'vacation' })
    expect(report().meta.careDays).toBe(17)
    expect(row(bears).planned.fte).toBeCloseTo(2.0, 9)
  })
})

describe('staffingMonth – children, staff and the facility total', () => {
  it('lists children without care type (not counted) and staff without qualification (100 %, never Fachkraft)', () => {
    setType(bears, 'regel')
    const ganztag = careType('Ganztag', 420, 900)
    children(3, bears, ganztag)
    children(2, bears, null)
    const eva = staff('Eva', null, { groupId: bears })
    const ada = staff('Ada', null, { groupId: bears })
    everyWeekday(eva)
    everyWeekday(ada)
    const bearsRow = row(bears)
    expect(bearsRow.children).toEqual({ total: 5, u3: 0 })
    expect(bearsRow.childrenWithoutCareType).toBe(2)
    expect(bearsRow.staffWithoutQualification).toEqual(['Ada', 'Eva'])
    expect(bearsRow.planned.fte).toBeCloseTo(2.0, 9)
    expect(bearsRow.planned.fachkraftFte).toBe(0)
    expect(report().total.staffWithoutQualification).toEqual(['Ada', 'Eva'])
    expect(report().total.childrenWithoutCareType).toBe(2)
  })

  it('counts U3 children by the first day of the month and uses the mit-U3 row', () => {
    setType(bears, 'regel')
    const ganztag = careType('Ganztag', 420, 900)
    children(10, bears, ganztag)
    // Turns 3 on 2026-10-02: still under 3 on the first.
    children(1, bears, ganztag, '2023-10-02')
    expect(row(bears).children).toEqual({ total: 11, u3: 1 })
    expect(row(bears).required.fte).toBeCloseTo(2.0, 9)
    expect(row(bears, 2026, 11).children.u3).toBe(0)
    expect(row(bears, 2026, 11).required.fte).toBeCloseTo(1.8, 9)
  })

  it('a group without group type: no demand row matches, its children are unmatched', () => {
    children(4, bears, careType('Ganztag', 420, 900))
    expect(row(bears)).toMatchObject({ groupType: null, unmatchedChildren: 4 })
    expect(row(bears).required.fte).toBe(0)
  })

  it('sums the groups for the facility, adds the facility lines and counts each child once', () => {
    setType(bears, 'regel')
    setType(mice, 'ganztag')
    const ganztag = careType('Ganztag', 420, 900)
    children(20, bears, ganztag)
    children(15, mice, ganztag)
    const anna = staff('Anna', 'fachkraft', { groupId: bears })
    const ben = staff('Ben', 'fachkraft', { groupId: mice })
    const springer = staff('Sina', 'fachkraft')
    for (const id of [anna, ben, springer]) everyWeekday(id)

    const result = report()
    expect(result.groups.map(r => r.groupId)).toEqual([bears, mice, null])
    const ungrouped = result.groups[2]!
    expect(ungrouped).toMatchObject({ name: '', groupType: null, children: { total: 0, u3: 0 } })
    expect(ungrouped.planned.fte).toBeCloseTo(1, 9)
    const { total } = result
    expect(total.children).toEqual({ total: 35, u3: 0 })
    expect(total.required.fte).toBeCloseTo(1.8 + 2.3, 9)
    const leitung = total.required.lines.find(l => l.key === 'leitung')!
    expect(leitung).toMatchObject({ label: 'Leitungszeit', counts: false })
    expect(leitung.fte).toBeCloseTo((6 + 2) / 39, 9)
    expect(total.planned.fte).toBeCloseTo(3, 9)
    expect(total.ok).toBe(false)
    expect(total.diff).toBeCloseTo(3 - 4.1, 9)
  })

  it('a duty counts for its entry group, else the home group; a child changing group counts in both that month', () => {
    setType(bears, 'regel')
    setType(mice, 'regel')
    const ganztag = careType('Ganztag', 420, 900)
    children(5, bears, ganztag)
    const [mover] = children(1, bears, ganztag)
    db.insert(childGroupChanges).values({ childId: mover!, groupId: mice, fromDate: '2026-10-15', createdAt: NOW }).run()
    const anna = staff('Anna', 'fachkraft', { groupId: bears })
    WEEKDAYS.forEach((date, i) => duty(anna, date, FULL_DAY[0], FULL_DAY[1], i < 11 ? {} : { groupId: mice }))

    expect(row(bears).children.total).toBe(6)
    expect(row(mice).children.total).toBe(1)
    expect(report().total.children.total).toBe(6)
    expect(row(bears).planned.fte).toBeCloseTo(0.5, 9)
    expect(row(mice).planned.fte).toBeCloseTo(0.5, 9)
    expect(row(bears, 2026, 11).children.total).toBe(5)
  })

  it('helpers count where they work, with their own qualification; help-outs elsewhere do not count', () => {
    setType(bears, 'regel')
    children(5, bears, careType('Ganztag', 420, 900))
    const krippe = addFacility(db, 'Krippe')
    const kim = staff('Kim', 'fachkraft', { facilityId: krippe })
    addHelpOut(db, kim, 1, 2026, 10)
    WEEKDAYS.forEach((date, i) => duty(kim, date, FULL_DAY[0], FULL_DAY[1], { helpFacilityId: 1, groupId: i < 11 ? bears : null }))
    const anna = staff('Anna', 'fachkraft', { groupId: bears })
    addHelpOut(db, anna, krippe, 2026, 10)
    WEEKDAYS.forEach((date, i) => duty(anna, date, FULL_DAY[0], FULL_DAY[1], i < 11 ? {} : { helpFacilityId: krippe }))

    expect(row(bears).planned.fte).toBeCloseTo(0.5 + 0.5, 9)
    expect(row(bears).planned.fachkraftFte).toBeCloseTo(1, 9)
    expect(row(null).planned.fte).toBeCloseTo(0.5, 9)
    expect(report().total.planned.fte).toBeCloseTo(1.5, 9)
  })

  it('codes crediting the daily target and breaks do not count; VZ does', () => {
    setType(bears, 'regel')
    children(5, bears, careType('Ganztag', 420, 900))
    const anna = staff('Anna', 'fachkraft', { groupId: bears })
    for (const date of WEEKDAYS) {
      // 7:00–15:18 with a 30-minute break = 7.8 h
      db.insert(entries).values({
        employeeId: anna, date, kind: 'shift', start: 420, end: 918, breakStart: 720, breakEnd: 750, countsAsStaff: true, updatedAt: NOW,
      }).run()
    }
    expect(row(bears).planned.fte).toBeCloseTo(1, 9)
    // VZ 15:18–16:00 on top (timed code): counts as working time.
    db.insert(entries).values({
      employeeId: anna, date: TUESDAY, kind: 'code', absenceCodeId: codeId(db, 'prep_time'), start: 918, end: 960, countsAsStaff: true, updatedAt: NOW,
    }).run()
    expect(row(bears).planned.fte).toBeCloseTo((22 * 468 + 42) / (39 * 60 * 22 / 5), 9)
    // Urlaub on a day with a duty: the day does not count.
    db.insert(entries).values({ employeeId: anna, date: WEDNESDAY, kind: 'code', absenceCodeId: codeId(db, 'vacation'), countsAsStaff: false, updatedAt: NOW }).run()
    expect(row(bears).planned.fte).toBeCloseTo((21 * 468 + 42) / (39 * 60 * 22 / 5), 9)
  })

  it('passes the age in months (BE: under-2 row) and the fte per child', () => {
    setState('BE')
    // 7:00–16:00 × 5 = 45 h: Ganztag (> 35 h, not above 45 h).
    const ganztag = careType('Ganztag', 420, 960)
    children(1, bears, ganztag, '2025-06-01') // 16 months on 2026-10-01
    const bearsRow = row(bears)
    expect(bearsRow.children.u3).toBe(1)
    expect(bearsRow.required.fte).toBeCloseTo(1 / 2.75, 9)
    expect(report().meta).toMatchObject({ land: 'BE', fteHoursPerWeek: 38.5, validFrom: '2026-08-01' })
  })

  it('a presence-only state (HB) has no Soll/Ist: ok is null', () => {
    setState('HB')
    children(5, bears, careType('Ganztag', 420, 900))
    const result = report()
    expect(result.meta.periodCheck).toBe(false)
    expect(result.groups.find(r => r.groupId === bears)!.ok).toBeNull()
    expect(result.total.ok).toBeNull()
  })

  it('rejects an invalid month', () => {
    expect(() => staffingMonth(db, 1, 2026, 13)).toThrow()
  })
})

describe('plan warnings – Review Focus 5 (BW presence)', () => {
  let anna: number
  let berta: number
  let dora: number
  let zoe: number
  beforeEach(() => {
    setType(bears, 'ganztag')
    setFacilityOpeningHours(db, 1, allWeek(420, 1020)) // 7:00–17:00
    // Hauptbetreuungszeit 7:00–15:00 (3 or 4 of 4 children present), Randzeit 15:00–17:00 (1 of 4).
    children(3, bears, careType('Früh', 420, 900))
    children(1, bears, careType('Spät', 720, 1020))
    anna = staff('Anna', 'fachkraft', { groupId: bears })
    berta = staff('Berta', 'fachkraft', { groupId: bears })
    dora = staff('Dora', 'fachkraft', { groupId: bears })
    // A Zusatzkraft who counts as Kraft (100 %), never as Fachkraft.
    zoe = staff('Zoe', 'ergaenzung', { groupId: bears, share: 100 })
    duty(anna, TUESDAY, 420, 900)
    duty(berta, TUESDAY, 480, 960)
    duty(dora, TUESDAY, 540, 1020)
    duty(zoe, TUESDAY, 420, 480)
  })

  it('one merged warning „Bären 7:00–8:00: 1 Fachkraft, nötig 2“', () => {
    const tuesday = staffingOf(planWarnings(), TUESDAY)
    expect(tuesday).toEqual([{
      type: 'staffing', date: TUESDAY, groupId: bears, groupName: 'Bären', from: 420, to: 480, have: 1, need: 2, fachkraft: true,
    }])
    const w = tuesday[0] as Extract<Warning, { type: 'staffing' }>
    expect(de.warnings.staffing(w.groupName, formatTime(w.from), formatTime(w.to), w.have, w.need, w.fachkraft))
      .toBe('Bären 7:00–8:00: 1 Fachkraft, nötig 2')
  })

  it('Randzeit needs one Fachkraft only; without anyone it warns with the right words', () => {
    // Dora leaves at 16:00: 16:00–17:00 nobody, 1 needed.
    db.delete(entries).where(eq(entries.employeeId, dora)).run()
    duty(dora, TUESDAY, 540, 960)
    const tuesday = staffingOf(planWarnings(), TUESDAY) as Extract<Warning, { type: 'staffing' }>[]
    expect(tuesday.map(w => [w.from, w.to, w.have, w.need, w.fachkraft])).toEqual([[420, 480, 1, 2, true], [960, 1020, 0, 1, true]])
    expect(de.warnings.staffing('Bären', '16:00', '17:00', 0, 1, true)).toBe('Bären 16:00–17:00: 0 Fachkräfte, nötig 1')
    expect(de.warnings.staffing('Bären', '7:00', '8:00', 1, 2, false)).toBe('Bären 7:00–8:00: 1 Kraft, nötig 2')
    expect(de.warnings.staffing('Bären', '7:00', '8:00', 2, 3, false)).toBe('Bären 7:00–8:00: 2 Kräfte, nötig 3')
  })

  it('checks only care days with entered opening hours', () => {
    // Saturday: nothing; a closure day: nothing; Wednesday without anyone: warnings.
    createClosure(db, admin, 1, { startDate: '2026-10-08', endDate: '2026-10-08', label: 'Teamtag', mode: 'closure_day' })
    const list = staffingWarnings(db, 1, 2026, 10)
    expect(staffingOf(list, '2026-10-10')).toEqual([])
    expect(staffingOf(list, '2026-10-08')).toEqual([])
    expect(staffingOf(list, WEDNESDAY).length).toBeGreaterThan(0)
    setFacilityOpeningHours(db, 1, null)
    expect(staffingWarnings(db, 1, 2026, 10)).toEqual([])
  })

  it('a duty for another group is with that group on the day', () => {
    db.delete(entries).where(eq(entries.employeeId, berta)).run()
    duty(berta, TUESDAY, 480, 960, { groupId: mice })
    // The bears keep only Anna until Dora comes at 9:00; the mice have no children, so nothing is needed there.
    const tuesday = staffingOf(planWarnings(), TUESDAY) as Extract<Warning, { type: 'staffing' }>[]
    expect(tuesday.map(w => [w.groupId, w.from, w.to, w.have, w.need])).toEqual([[bears, 420, 540, 1, 2]])
  })

  it('children count in the group of the day', () => {
    // All four children move to the mice on Wednesday: the bears have no children that day, the mice do.
    const ids = db.select({ id: childGroupChanges.childId }).from(childGroupChanges).all().map(r => r.id)
    for (const childId of ids) db.insert(childGroupChanges).values({ childId, groupId: mice, fromDate: WEDNESDAY, createdAt: NOW }).run()
    const list = staffingWarnings(db, 1, 2026, 10) as Extract<Warning, { type: 'staffing' }>[]
    expect(list.filter(w => w.date === WEDNESDAY && w.groupId === bears)).toEqual([])
    expect(list.filter(w => w.date === WEDNESDAY && w.groupId === mice).length).toBeGreaterThan(0)
    expect(list.filter(w => w.date === TUESDAY && w.groupId === mice)).toEqual([])
  })

  it('helpers of another facility count in the group of their entry', () => {
    const krippe = addFacility(db, 'Krippe')
    const kim = staff('Kim', 'fachkraft', { facilityId: krippe })
    addHelpOut(db, kim, 1, 2026, 10)
    duty(kim, TUESDAY, 420, 480, { helpFacilityId: 1, groupId: bears })
    expect(staffingOf(planWarnings(), TUESDAY)).toEqual([])
  })
})
