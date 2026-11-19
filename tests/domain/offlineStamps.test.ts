import { describe, expect, it } from 'vitest'
import { clockSkewMinutes, offlineStampTimeCheck } from '../../shared/domain/offlineStamps'

const now = new Date('2026-11-19T10:00:00Z')
const minutes = (value: number) => new Date(now.getTime() + value * 60_000)

describe('offline stamps', () => {
  it('takes stamps up to 5 minutes ahead and up to 7 days old', () => {
    expect(offlineStampTimeCheck(minutes(5), now)).toBe('ok')
    expect(offlineStampTimeCheck(minutes(6), now)).toBe('in_future')
    expect(offlineStampTimeCheck(minutes(-7 * 24 * 60), now)).toBe('ok')
    expect(offlineStampTimeCheck(minutes(-7 * 24 * 60 - 1), now)).toBe('too_old')
  })
  it('names the tablet clock difference only beyond 5 minutes', () => {
    expect(clockSkewMinutes(minutes(5), now)).toBeNull()
    expect(clockSkewMinutes(minutes(-5), now)).toBeNull()
    expect(clockSkewMinutes(minutes(6), now)).toBe(6)
    expect(clockSkewMinutes(minutes(-12), now)).toBe(-12)
    expect(clockSkewMinutes(new Date(now.getTime() + 7.6 * 60_000), now)).toBe(8)
  })
})
