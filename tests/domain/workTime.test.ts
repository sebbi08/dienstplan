import { describe, expect, it } from 'vitest'
import { exceedsMaxDailyWith, workTime } from '../../app/utils/workTime'
import { shift } from '../helpers/entries'

const times = (start: string, end: string, breakStart = '', breakEnd = '') => ({ start, end, breakStart, breakEnd })

describe('workTime', () => {
  it('is null while the input is incomplete or unreadable', () => {
    expect(workTime(times('', ''))).toBeNull()
    expect(workTime(times('7:00', ''))).toBeNull()
    expect(workTime(times('7:00', 'abc'))).toBeNull()
    expect(workTime(times('15:00', '7:00'))).toBeNull()
    expect(workTime(times('7:00', '7:00'))).toBeNull()
    expect(workTime(times('7:00', '15:30', '12:00', ''))).toBeNull()
    expect(workTime(times('7:00', '15:30', '12:00', 'xx'))).toBeNull()
  })

  it('counts presence, working time and the required break', () => {
    expect(workTime(times('7:00', '15:30', '12:00', '12:30'))).toEqual({ present: 510, worked: 480, required: 30, ok: true })
  })

  it('flags a missing break', () => {
    expect(workTime(times('7:00', '15:30'))).toEqual({ present: 510, worked: 510, required: 30, ok: false })
  })

  it('needs no break for a short day', () => {
    expect(workTime(times('8:00', '13:00'))).toEqual({ present: 300, worked: 300, required: 0, ok: true })
  })

  it('does not count a break under 15 minutes', () => {
    expect(workTime(times('7:00', '14:00', '11:00', '11:10')).ok).toBe(false)
  })
})

describe('exceedsMaxDailyWith (§ 3 ArbZG in the entry dialogs)', () => {
  const D = '2026-10-06'
  const special = { kind: 'special', creditMode: 'timed', codeKey: null } as const
  it('counts the typed times with the other entries of the day, breaks left out', () => {
    expect(exceedsMaxDailyWith(times('7:00', '17:00'), special, [[]])).toBe(false)
    expect(exceedsMaxDailyWith(times('7:00', '17:05'), special, [[]])).toBe(true)
    expect(exceedsMaxDailyWith(times('7:00', '17:30', '12:00', '12:30'), special, [[]])).toBe(false)
    const morning = [shift(1, D, 420, 780)]
    expect(exceedsMaxDailyWith(times('14:00', '18:00'), special, [morning])).toBe(false)
    expect(exceedsMaxDailyWith(times('14:00', '18:05'), special, [morning])).toBe(true)
  })
  it('warns when one of several cells would exceed, never for unreadable times', () => {
    expect(exceedsMaxDailyWith(times('14:00', '18:05'), special, [[], [shift(2, D, 420, 780)]])).toBe(true)
    expect(exceedsMaxDailyWith(times('14:00', ''), special, [[shift(2, D, 420, 780)]])).toBe(false)
    expect(exceedsMaxDailyWith(times('7:00', '18:00'), special, [])).toBe(false)
  })
  it('lets a typed Überstundenfrei or break shorten the day', () => {
    const long = [shift(1, D, 420, 1110)]
    expect(exceedsMaxDailyWith(times('17:00', '18:30'), { kind: 'code', creditMode: 'none', codeKey: 'overtime_off' }, [long])).toBe(false)
    const noBreak = [shift(1, D, 420, 1050)] // 7:00–17:30
    expect(exceedsMaxDailyWith(times('12:00', '12:45'), { kind: 'break', creditMode: 'none', codeKey: null }, [noBreak])).toBe(false)
    expect(exceedsMaxDailyWith(times('12:00', '12:15'), { kind: 'break', creditMode: 'none', codeKey: null }, [noBreak])).toBe(true)
  })
})
