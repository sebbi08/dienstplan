import { describe, expect, it } from 'vitest'
import { clockSkewMinutes, offlineStampTimeCheck, tabletStatus } from '../../shared/domain/offlineStamps'

const now = new Date('2026-11-19T10:00:00Z')
const minutes = (value: number) => new Date(now.getTime() + value * 60_000)

describe('offline stamps', () => {
  it('takes stamps up to 5 minutes ahead and up to 7 days old', () => {
    expect(offlineStampTimeCheck(minutes(5), now)).toBe('ok')
    expect(offlineStampTimeCheck(minutes(6), now)).toBe('in_future')
    expect(offlineStampTimeCheck(minutes(-7 * 24 * 60), now)).toBe('ok')
    expect(offlineStampTimeCheck(minutes(-7 * 24 * 60 - 1), now)).toBe('too_old')
  })
  it('widens the future tolerance by a known tablet lead, at most 60 minutes, never by a tablet behind', () => {
    expect(offlineStampTimeCheck(minutes(14), now, 10)).toBe('ok')
    expect(offlineStampTimeCheck(minutes(16), now, 10)).toBe('in_future')
    expect(offlineStampTimeCheck(minutes(65), now, 600)).toBe('ok')
    expect(offlineStampTimeCheck(minutes(66), now, 600)).toBe('in_future')
    expect(offlineStampTimeCheck(minutes(6), now, -30)).toBe('in_future')
  })
  it('tells the tablet only done or rejected', () => {
    expect(tabletStatus('recorded')).toBe('done')
    expect(tabletStatus('duplicate')).toBe('done')
    expect(tabletStatus('review')).toBe('rejected')
    expect(tabletStatus('rejected')).toBe('rejected')
  })
  it('names the tablet clock difference only beyond 5 minutes', () => {
    expect(clockSkewMinutes(minutes(5), now)).toBeNull()
    expect(clockSkewMinutes(minutes(-5), now)).toBeNull()
    expect(clockSkewMinutes(minutes(6), now)).toBe(6)
    expect(clockSkewMinutes(minutes(-12), now)).toBe(-12)
    expect(clockSkewMinutes(new Date(now.getTime() + 7.6 * 60_000), now)).toBe(8)
  })
})
