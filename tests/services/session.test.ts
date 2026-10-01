import { describe, expect, it } from 'vitest'
import { USER_SESSION_DAYS, sessionExpired } from '../../server/lib/session'

const now = new Date('2026-10-01T12:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

describe('sessionExpired', () => {
  it('keeps the 30-day limit for normal accounts', () => {
    expect(USER_SESSION_DAYS).toBe(30)
    expect(sessionExpired('observer', daysAgo(29), now)).toBe(false)
    expect(sessionExpired('admin', daysAgo(30), now)).toBe(false)
    expect(sessionExpired('observer', daysAgo(30.01), now)).toBe(true)
    expect(sessionExpired('admin', daysAgo(31), now)).toBe(true)
  })
  it('rejects normal sessions without a valid login time (issued before the rule existed)', () => {
    expect(sessionExpired('observer', undefined, now)).toBe(true)
    expect(sessionExpired('admin', 'garbage', now)).toBe(true)
  })
  it('never expires the tablet session server-side', () => {
    expect(sessionExpired('terminal', daysAgo(300), now)).toBe(false)
    expect(sessionExpired('terminal', undefined, now)).toBe(false)
  })
})
