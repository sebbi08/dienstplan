import { describe, expect, it } from 'vitest'
import { workTime } from '../../app/utils/workTime'

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
