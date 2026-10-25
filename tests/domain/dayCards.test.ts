import { describe, expect, it } from 'vitest'
import type { MyPlanDayDto, TimeDayDto } from '../../shared/types/api'
import { isCompactMyPlanDay, isCompactTimeDay } from '../../app/utils/dayCards'

const timeDay = (patch: Partial<TimeDayDto> = {}): TimeDayDto => ({
  date: '2026-10-24', weekday: 6, isWeekend: true, holidayKey: null, plan: '', plannedMinutes: 0, target: 0, records: [],
  recordedMinutes: 0, counted: 0, usesRecords: false, absence: false, otherEntries: false, targetCredit: false, warnings: [],
  note: '', changes: [], plannedDuty: false, sickLeave: null, lateMinutes: null, earlyMinutes: null, ...patch,
})

const planDay = (patch: Partial<MyPlanDayDto> = {}): MyPlanDayDto => ({
  date: '2026-10-24', weekday: 6, isWeekend: true, holidayKey: null, closureLabel: null, info1: '', info2: '', autoEvents: [],
  entries: [], changes: [], ...patch,
})

describe('isCompactTimeDay', () => {
  it('shrinks a weekend or free day without anything stamped or noted', () => {
    expect(isCompactTimeDay(timeDay())).toBe(true)
    expect(isCompactTimeDay(timeDay({ isWeekend: false, plan: 'Urlaub', absence: true, targetCredit: true }))).toBe(true)
  })

  it('keeps the card for a duty, a stamped time, a hint, a sick mark, a reason or a change', () => {
    expect(isCompactTimeDay(timeDay({ plannedDuty: true, plan: 'Früh 7–15' }))).toBe(false)
    const record = { id: 1, date: '2026-10-24', start: 420, end: 900 } as TimeDayDto['records'][number]
    expect(isCompactTimeDay(timeDay({ records: [record] }))).toBe(false)
    expect(isCompactTimeDay(timeDay({ warnings: [{ type: 'x' } as unknown as TimeDayDto['warnings'][number]] }))).toBe(false)
    expect(isCompactTimeDay(timeDay({ sickLeave: { leftAt: null, note: null } as unknown as TimeDayDto['sickLeave'] }))).toBe(false)
    expect(isCompactTimeDay(timeDay({ note: 'Arzttermin' }))).toBe(false)
    expect(isCompactTimeDay(timeDay({ changes: [{} as TimeDayDto['changes'][number]] }))).toBe(false)
  })
})

describe('isCompactMyPlanDay', () => {
  it('shrinks a day with nothing on it', () => {
    expect(isCompactMyPlanDay(planDay(), 0)).toBe(true)
    expect(isCompactMyPlanDay(planDay({ holidayKey: 'christmas' as MyPlanDayDto['holidayKey'] }), 0)).toBe(true)
  })

  it('keeps the card for an entry, a stamped time, info, an event or a change', () => {
    expect(isCompactMyPlanDay(planDay({ entries: [{} as MyPlanDayDto['entries'][number]] }), 0)).toBe(false)
    expect(isCompactMyPlanDay(planDay(), 1)).toBe(false)
    expect(isCompactMyPlanDay(planDay({ info1: 'Ausflug' }), 0)).toBe(false)
    expect(isCompactMyPlanDay(planDay({ info2: 'Team' }), 0)).toBe(false)
    expect(isCompactMyPlanDay(planDay({ autoEvents: ['Geburtstag'] }), 0)).toBe(false)
    expect(isCompactMyPlanDay(planDay({ changes: [{} as MyPlanDayDto['changes'][number]] }), 0)).toBe(false)
  })
})
