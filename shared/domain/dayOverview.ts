import { isFullDayTimed } from './balance'
import type { CodeKey, DomainEntry, Minutes } from './types'

/**
 * 'home_office': working from home, so not present in the house. 'office_day': a whole Büro/VZ day without times — it
 * has no time window, so it is never counted as present (like the group attendance, which counts timed entries only).
 */
export type SlotState =
  | 'off' | 'work' | 'support' | 'break'
  | 'absent' | 'prep_time' | 'office' | 'doctor' | 'office_day' | 'home_office' | 'holiday' | 'other'

export const SLOT_MINUTES = 15
const DEFAULT_START = 7 * 60
const DEFAULT_END = 17 * 60
const PRESENT_STATES: SlotState[] = ['work', 'prep_time', 'office']

export interface OverviewInput {
  employeeId: number
  entries: DomainEntry[]
}

export interface OverviewRow {
  employeeId: number
  states: SlotState[]
}

export interface DayOverview {
  slotStarts: Minutes[]
  rows: OverviewRow[]
  present: number[]
}

function codeState(codeKey: CodeKey | null): SlotState {
  switch (codeKey) {
    case 'vacation': case 'special_leave': case 'sick': case 'child_sick': case 'training': case 'school': case 'overtime_off': return 'absent'
    case 'prep_time': return 'prep_time'
    case 'office': return 'office'
    case 'doctor': return 'doctor'
    case 'holiday': case 'closure_day': return 'holiday'
    default: return 'other'
  }
}

function stateAt(entries: DomainEntry[], time: Minutes): SlotState {
  let state: SlotState = 'off'
  for (const entry of entries) {
    if (entry.start === null || entry.end === null || time < entry.start || time >= entry.end) continue
    if (entry.kind === 'break') return 'break'
    if (entry.breakStart !== null && entry.breakEnd !== null && time >= entry.breakStart && time < entry.breakEnd) {
      return 'break'
    }
    const entryState: SlotState = entry.homeOffice === true
      ? 'home_office'
      : entry.kind === 'code' ? codeState(entry.codeKey) : entry.countsAsStaff ? 'work' : 'support'
    if (state === 'off' || state === 'work') state = entryState
  }
  return state
}

export function buildDayOverview(inputs: OverviewInput[], isHolidayDay: boolean): DayOverview {
  const timed = inputs.flatMap(input => input.entries).filter(entry => entry.start !== null && entry.end !== null)
  const earliest = Math.min(DEFAULT_START, ...timed.map(entry => Math.floor(entry.start! / 60) * 60))
  const latest = Math.max(DEFAULT_END, ...timed.map(entry => Math.ceil(entry.end! / 60) * 60))
  const slotStarts: Minutes[] = []
  for (let time = earliest; time < latest; time += SLOT_MINUTES) slotStarts.push(time)

  const rows = inputs.map(({ employeeId, entries }): OverviewRow => {
    // An entry without times fills the day: a whole home-office day („Homeoffice (ganzer Tag)“) is not in the house.
    const fullDay = entries.find(entry => entry.start === null)
    const fill: SlotState | null = fullDay
      ? fullDay.homeOffice === true ? 'home_office' : isFullDayTimed(fullDay) ? 'office_day' : codeState(fullDay.codeKey)
      : entries.length === 0 && isHolidayDay ? 'holiday' : null
    const states = slotStarts.map((time) => {
      const state = stateAt(entries, time)
      return state === 'off' && fill ? fill : state
    })
    return { employeeId, states }
  })

  const present = slotStarts.map((_, index) => rows.filter(row => PRESENT_STATES.includes(row.states[index]!)).length)
  return { slotStarts, rows, present }
}
