import { describe, expect, it } from 'vitest'
import type { EmployeeColumnDto, EntryDto, MonthPlanDto } from '../../shared/types/api'
import { dayOverviewPeople, longAbsenceCells, longAbsencePeople, planWithoutHidden } from '../../app/utils/longAbsence'

/** The parts of a month plan the helpers read (the rest is not looked at). */
function plan(values: Partial<MonthPlanDto>): MonthPlanDto {
  return {
    employees: [], entries: [], admin: null,
    longAbsence: { people: [], hidden: [], cells: {}, dutyCells: [] },
    ...values,
  } as MonthPlanDto
}
const column = (id: number, groupId: number | null = null): EmployeeColumnDto => ({ id, name: `P${id}`, shortName: `P${id}`, helpFrom: null, groupId })
const shift = (employeeId: number, date: string): EntryDto => ({
  id: employeeId * 100, employeeId, date, kind: 'special', templateId: null, codeId: null, codeKey: null, creditMode: 'timed', start: 465,
  end: 960, breakStart: null, breakEnd: null, countsAsStaff: true, note: null, helpFacilityId: null, groupId: null, homeOffice: false,
  label: '7:45–16:00', shortLabel: null, color: null,
} as EntryDto)
const person = (employeeId: number, from: string, to: string | null, groupId: number | null = null) =>
  ({ employeeId, name: `P${employeeId}`, from, to, reason: null, groupId })

describe('„im Plan zeigen“ and the grid without the persons taken out of the plan', () => {
  const full = plan({
    employees: [column(1), column(2)],
    entries: [shift(1, '2026-12-01'), shift(2, '2026-12-01')],
    longAbsence: { people: [person(2, '2026-11-02', null)], hidden: [2], cells: { '2|2026-12-02': 'sick' }, dutyCells: [] },
    admin: { warnings: [{ type: 'missing_entry', date: '2026-12-02', employeeId: 2 }, { type: 'missing_entry', date: '2026-12-02', employeeId: 1 }] } as MonthPlanDto['admin'],
  })

  it('leaves out a hidden person\'s column, entries and hints until shown again', () => {
    const grid = planWithoutHidden(full)
    expect(grid.employees.map(employee => employee.id)).toEqual([1])
    expect(grid.entries.map(entry => entry.employeeId)).toEqual([1])
    expect(grid.admin!.warnings).toEqual([{ type: 'missing_entry', date: '2026-12-02', employeeId: 1 }])
    const shown = planWithoutHidden(full, new Set([2]))
    expect(shown.employees.map(employee => employee.id)).toEqual([1, 2])
    expect(shown.admin!.warnings).toHaveLength(2)
    // The marks of the shown-again person come along, with the reason the server sent (masked or not).
    expect(longAbsenceCells(shown).get('2|2026-12-02')).toBe('Langzeitkrank')
    // Nobody hidden: the plan as it is.
    expect(planWithoutHidden(plan({ employees: [column(1)] })).employees).toHaveLength(1)
  })

  it('names in the line only the group chosen above the plan and the Springer', () => {
    const withGroups = plan({ longAbsence: { people: [person(1, '2026-12-01', null, 7), person(2, '2026-12-01', null, 8), person(3, '2026-12-01', null)], hidden: [], cells: {}, dutyCells: [] } })
    expect(longAbsencePeople(withGroups, null).map(item => item.employeeId)).toEqual([1, 2, 3])
    expect(longAbsencePeople(withGroups, 7).map(item => item.employeeId)).toEqual([1, 3])
  })
})

describe('the day overview on a day of a long absence', () => {
  it('lists nobody away that day, but a duty planned anyway – apart and not counted in an entered one', () => {
    const day = '2026-12-03'
    const overview = plan({
      entries: [shift(2, day), shift(3, day)],
      longAbsence: {
        people: [person(1, '2026-12-01', null), person(2, '2026-12-01', null), person(3, '2026-12-01', null)], hidden: [], cells: {},
        dutyCells: [`2|${day}`],
      },
    })
    const result = dayOverviewPeople(overview, [column(1), column(2), column(3), column(4)], day)
    // 1: away, nothing planned – not listed; 2: duty in an entered one – apart; 3: duty during a booked Mutterschutz – counted.
    expect(result.counted.map(employee => employee.id)).toEqual([3, 4])
    expect(result.kept.map(employee => employee.id)).toEqual([2])
    expect(dayOverviewPeople(overview, [column(1)], '2026-11-30').counted.map(employee => employee.id)).toEqual([1])
  })
})
