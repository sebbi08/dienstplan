import { describe, expect, it } from 'vitest'
import { addDays, weekday } from '../../shared/domain/dates'
import { BW_RULES } from '../../shared/domain/holidays'
import type { DayHours, OpeningHours } from '../../shared/domain/openingHours'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { DomainEntry } from '../../shared/domain/types'
import {
  coverageWarnings, dayWarnings, type CoverageRule, type DayHoursContext, type EmployeeDay, type Warning,
} from '../../shared/domain/warnings'
import { templateCoverageWarnings, templateWeekdayDate, type TemplateCoverageEntry } from '../../shared/domain/weekTemplates'
import { shift, special } from '../helpers/entries'

const open = (from: number, to: number): DayHours => ({ open: from, close: to, closed: false })
const closedDay: DayHours = { open: null, close: null, closed: true }
const week = (days: DayHours[], minAtOpening = 1, minAtClosing = 1): OpeningHours => ({ days, minAtOpening, minAtClosing })
const allDays = (value: DayHours) => [value, value, value, value, value]
const none: DayHoursContext = { facility: null, groups: [] }

/** A template entry on a weekday (0 = Monday), built like a plan entry without a date. */
const at = (entry: DomainEntry, day: number): TemplateCoverageEntry => ({ ...entry, date: '', weekday: day })
const homeGroups = (groups: Record<number, number | null>) => (employeeId: number) => groups[employeeId] ?? null
const texts = (list: { weekday: number; warning: Warning }[]) => list.map(({ weekday: day, warning }) => ({ day, ...strip(warning) }))
function strip(warning: Warning) {
  const { date: _date, ...rest } = warning
  return rest
}

describe('the template weekday a plan day stands for', () => {
  it('gives a date on that weekday, Monday to Sunday', () => {
    for (let day = 0; day < 7; day++) expect(weekday(templateWeekdayDate(day))).toBe(day)
  })
})

describe('coverageWarnings (the plan\'s coverage part, shared with the template editor)', () => {
  const monday = '2026-10-05'
  it('checks Pflichtdienste and edges without any holiday logic (a public holiday is checked too)', () => {
    const rule: CoverageRule = { id: 1, label: 'Früh', start: 420, end: null, minCount: 1 }
    const hours = { facility: week(allDays(open(420, 990))), groups: [] }
    // 2026-10-03 is a Saturday; 2025-12-25 (Christmas, Thursday) is a holiday: coverageWarnings still checks it.
    expect(coverageWarnings('2025-12-25', [], [rule], hours).map(warning => warning.type)).toEqual(['coverage', 'edge', 'edge'])
    expect(dayWarnings('2025-12-25', [], [rule], false, BW_RULES, hours)).toEqual([])
    expect(coverageWarnings(monday, [{ entry: shift(1, monday, 420, 990), groupId: null }], [rule], hours)).toEqual([])
  })
})

describe('templateCoverageWarnings', () => {
  const facilityHours = week(allDays(open(390, 1020)))
  const hours: DayHoursContext = { facility: facilityHours, groups: [] }

  it('warns per weekday about too few staff at opening and until closing of the facility', () => {
    const entries = [at(shift(1, '', 390, 1020), 0), at(shift(1, '', 450, 1020), 1), at(shift(1, '', 390, 900), 2)]
    const result = templateCoverageWarnings(entries, homeGroups({}), [], hours)
    expect(texts(result)).toEqual([
      { day: 1, type: 'edge', edge: 'opening', time: 390, found: 0, required: 1 },
      { day: 2, type: 'edge', edge: 'closing', time: 1020, found: 0, required: 1 },
      { day: 3, type: 'edge', edge: 'opening', time: 390, found: 0, required: 1 },
      { day: 3, type: 'edge', edge: 'closing', time: 1020, found: 0, required: 1 },
      { day: 4, type: 'edge', edge: 'opening', time: 390, found: 0, required: 1 },
      { day: 4, type: 'edge', edge: 'closing', time: 1020, found: 0, required: 1 },
    ])
    expect(result[0]!.warning.date).toBe(templateWeekdayDate(1))
  })

  it('checks a group with own opening hours with the duties of its members only', () => {
    const groupHours = week(allDays(open(390, 960)))
    const context: DayHoursContext = { facility: null, groups: [{ groupId: 5, groupName: 'Bären', hours: groupHours }] }
    // Anna (Bären) covers Monday; Berta (other group) on Tuesday does not count for the Bären.
    const entries = [at(shift(1, '', 390, 960), 0), at(shift(2, '', 390, 960), 1)]
    const result = templateCoverageWarnings(entries, homeGroups({ 1: 5, 2: 6 }), [], context)
    expect(texts(result).filter(item => item.day < 2)).toEqual([
      { day: 1, type: 'edge', edge: 'opening', time: 390, found: 0, required: 1, groupName: 'Bären', groupId: 5 },
      { day: 1, type: 'edge', edge: 'closing', time: 960, found: 0, required: 1, groupName: 'Bären', groupId: 5 },
    ])
  })

  it('checks Pflichtdienste on their ticked weekdays only, a group rule with its members\' duties', () => {
    const late: CoverageRule = { id: 3, label: 'Spätdienst', start: 960, end: 1020, minCount: 1, weekdays: 4 } // Wednesday
    const group: CoverageRule = { id: 4, label: 'Früh', start: 390, end: null, minCount: 1, weekdays: 1, groupId: 5, groupName: 'Bären' }
    const entries = [at(shift(2, '', 390, 720), 0)]
    const result = templateCoverageWarnings(entries, homeGroups({ 2: 6 }), [late, group], none)
    expect(texts(result)).toEqual([
      { day: 0, type: 'coverage', ruleId: 4, label: 'Früh', found: 0, required: 1, groupName: 'Bären' },
      { day: 2, type: 'coverage', ruleId: 3, label: 'Spätdienst', found: 0, required: 1 },
    ])
    const covered = [at(shift(1, '', 390, 720), 0), at(special(2, '', 960, 1020), 2)]
    expect(templateCoverageWarnings(covered, homeGroups({ 1: 5 }), [late, group], none)).toEqual([])
  })

  it('does not count home office (nobody in the house) nor a duty that does not count as staff', () => {
    const atHome = shift(1, '', 390, 1020, null, null, { homeOffice: true })
    const kitchen = shift(2, '', 390, 1020, null, null, { countsAsStaff: false })
    const rule: CoverageRule = { id: 1, label: 'Früh', start: 390, end: null, minCount: 1, weekdays: 1 }
    const result = templateCoverageWarnings([at(atHome, 0), at(kitchen, 0)], homeGroups({}), [rule], hours)
    expect(texts(result).filter(item => item.day === 0)).toEqual([
      // The rule counts the kitchen duty (as the plan does: Pflichtdienste count by times), never the home office.
      { day: 0, type: 'edge', edge: 'opening', time: 390, found: 0, required: 1 },
      { day: 0, type: 'edge', edge: 'closing', time: 1020, found: 0, required: 1 },
    ])
    const ruleOnly = templateCoverageWarnings([at(atHome, 0)], homeGroups({}), [rule], none)
    expect(texts(ruleOnly)).toEqual([{ day: 0, type: 'coverage', ruleId: 1, label: 'Früh', found: 0, required: 1 }])
  })

  it('skips closed weekdays and never checks Saturday or Sunday without opening hours for them', () => {
    const rule: CoverageRule = { id: 1, label: 'Früh', start: 390, end: null, minCount: 1 }
    const closedMonday = week([closedDay, open(390, 1020), open(390, 1020), open(390, 1020), open(390, 1020)])
    const result = templateCoverageWarnings([], homeGroups({}), [rule], { facility: closedMonday, groups: [] })
    expect([...new Set(result.map(item => item.weekday))]).toEqual([1, 2, 3, 4])
  })

  it('gives a group template only the warnings of its group', () => {
    const facilityRule: CoverageRule = { id: 1, label: 'Früh', start: 390, end: null, minCount: 1, weekdays: 1 }
    const groupRule: CoverageRule = { ...facilityRule, id: 2, groupId: 5, groupName: 'Bären' }
    const otherRule: CoverageRule = { ...facilityRule, id: 3, groupId: 6, groupName: 'Mäuse' }
    const context: DayHoursContext = {
      facility: week([open(390, 1020), closedDay, closedDay, closedDay, closedDay]),
      groups: [
        { groupId: 5, groupName: 'Bären', hours: week([open(420, 960), closedDay, closedDay, closedDay, closedDay]) },
        { groupId: 6, groupName: 'Mäuse', hours: week([open(420, 960), closedDay, closedDay, closedDay, closedDay]) },
      ],
    }
    const result = templateCoverageWarnings([], homeGroups({}), [facilityRule, groupRule, otherRule], context, 5)
    expect(texts(result)).toEqual([
      { day: 0, type: 'coverage', ruleId: 2, label: 'Früh', found: 0, required: 1, groupName: 'Bären' },
      { day: 0, type: 'edge', edge: 'opening', time: 420, found: 0, required: 1, groupName: 'Bären', groupId: 5 },
      { day: 0, type: 'edge', edge: 'closing', time: 960, found: 0, required: 1, groupName: 'Bären', groupId: 5 },
    ])
  })
})

describe('the plan and the template editor count alike (one shared implementation)', () => {
  const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: BW_RULES }
  // 2026-10-05 is a Monday, no holiday in that week (Baden-Württemberg).
  const planMonday = '2026-10-05'
  const rules: CoverageRule[] = [
    { id: 1, label: 'Frühdienst ab 6:30', start: 390, end: null, minCount: 2 },
    { id: 2, label: 'Spätdienst', start: 960, end: 1020, minCount: 1, weekdays: 4 | 16 },
    { id: 3, label: 'Früh Bären', start: 420, end: null, minCount: 1, groupId: 5, groupName: 'Bären' },
  ]
  const hours: DayHoursContext = {
    facility: week([open(390, 1020), open(390, 1020), open(390, 1020), open(390, 960), closedDay], 2, 1),
    groups: [{ groupId: 5, groupName: 'Bären', hours: week(allDays(open(420, 960))) }],
  }
  const groupOf: Record<number, number | null> = { 1: 5, 2: 5, 3: null, 4: 6 }
  /** One week: per weekday, per employee, the duties (a plan entry without its date). */
  const duties: Record<number, DomainEntry[][]> = {
    0: [[shift(1, '', 390, 960)], [shift(2, '', 420, 900)], [special(3, '', 960, 1020)], []],
    1: [[shift(1, '', 420, 960, 720, 750)], [], [shift(3, '', 390, 1020, null, null, { homeOffice: true })], [shift(4, '', 390, 800)]],
    2: [[], [shift(2, '', 390, 1020)], [special(3, '', 960, 1020)], [shift(4, '', 390, 720, null, null, { countsAsStaff: false })]],
    3: [[shift(1, '', 390, 960)], [shift(2, '', 390, 900)], [], []],
    4: [[shift(1, '', 390, 960)], [], [], []],
  }

  it('gives the same coverage warnings for a plan week and the same template', () => {
    const planWarnings = [0, 1, 2, 3, 4].flatMap((day) => {
      const date = addDays(planMonday, day)
      const employees: EmployeeDay[] = duties[day]!.map((list, index) => ({
        employeeId: index + 1, groupId: groupOf[index + 1] ?? null, info, entries: list.map(entry => ({ ...entry, date })),
      }))
      return dayWarnings(date, employees, rules, false, BW_RULES, hours)
        .filter(warning => warning.type === 'coverage' || warning.type === 'edge')
        .map(warning => ({ day, ...strip(warning) }))
    })
    const templateEntries = [0, 1, 2, 3, 4].flatMap(day => duties[day]!.flat().map(entry => at(entry, day)))
    const templateWarnings = texts(templateCoverageWarnings(templateEntries, homeGroups(groupOf), rules, hours))
    expect(planWarnings.length).toBeGreaterThan(3)
    expect(templateWarnings).toEqual(planWarnings)
  })
})
