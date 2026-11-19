import { describe, expect, it } from 'vitest'
import { OFFLINE_BATCH_MAX } from '../../shared/domain/offlineStamps'
import {
  buildSyncPayload, isoWithOffset, isRateLimited, isServerUnreachable, retryDelay, settledIds, sortQueue, tabletClockTime,
} from '../../app/utils/offlineQueue'
import { offlineHintParts, offlineHintText } from '../../app/utils/offlineHints'
import { de } from '../../app/locales/de'

const item = (seq: number, stampedAt: string) => ({
  seq, clientId: `c${seq}`, employeeId: seq, action: 'in' as const, stampedAt, pin: `00000${seq % 10}`,
})

describe('offline queue of the tablet', () => {
  it('keeps the order of the taps, not of the tablet clock', () => {
    const queue = [item(3, '2026-11-19T07:00:00+01:00'), item(1, '2026-11-19T09:00:00+01:00'), item(2, '2026-11-19T08:00:00+01:00')]
    expect(sortQueue(queue).map(entry => entry.seq)).toEqual([1, 2, 3])
    // The input stays as it was.
    expect(queue.map(entry => entry.seq)).toEqual([3, 1, 2])
  })

  it('builds the request in tap order with the tablet clock, at most 100 stamps, nothing but the sent fields', () => {
    const payload = buildSyncPayload([item(2, '2026-11-19T08:00:00+01:00'), item(1, '2026-11-19T07:58:00+01:00')], new Date(2026, 10, 19, 10, 0, 0))
    expect(payload.clientNow).toMatch(/^2026-11-19T10:00:00[+-]\d{2}:\d{2}$/)
    expect(payload.stamps).toEqual([
      { clientId: 'c1', employeeId: 1, pin: '000001', action: 'in', stampedAt: '2026-11-19T07:58:00+01:00' },
      { clientId: 'c2', employeeId: 2, pin: '000002', action: 'in', stampedAt: '2026-11-19T08:00:00+01:00' },
    ])
    const many = Array.from({ length: OFFLINE_BATCH_MAX + 5 }, (_, index) => item(index + 1, '2026-11-19T08:00:00+01:00'))
    const first = buildSyncPayload(many, new Date())
    expect(first.stamps).toHaveLength(OFFLINE_BATCH_MAX)
    expect(first.stamps[0]!.clientId).toBe('c1')
  })

  it('writes the tablet time as ISO with offset that names the same moment', () => {
    const now = new Date('2026-11-19T06:58:12.345Z')
    const text = isoWithOffset(now)
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(new Date(text).getTime()).toBe(Math.floor(now.getTime() / 1000) * 1000)
    expect(tabletClockTime(new Date(2026, 10, 19, 7, 5))).toBe('07:05')
  })

  it('drops every answered stamp from the queue', () => {
    expect(settledIds([{ clientId: 'a', status: 'done' }, { clientId: 'b', status: 'rejected' }])).toEqual(['a', 'b'])
  })

  it('takes a timeout as „not reachable“ and a 429 as a quiet retry', () => {
    // ofetch's timeout: a FetchError without a status.
    expect(isServerUnreachable({ name: 'FetchError', cause: { name: 'TimeoutError' } })).toBe(true)
    expect(isRateLimited({ status: 429 })).toBe(true)
    expect(isRateLimited({ status: 500 })).toBe(false)
    expect(isServerUnreachable({ status: 429 })).toBe(false)
  })

  it('keeps stamps offline only when the server cannot be reached', () => {
    expect(isServerUnreachable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isServerUnreachable({ status: undefined })).toBe(true)
    for (const status of [502, 503, 504]) expect(isServerUnreachable({ status })).toBe(true)
    expect(isServerUnreachable({ statusCode: 503 })).toBe(true)
    for (const status of [400, 401, 403, 409, 423, 500]) expect(isServerUnreachable({ status })).toBe(false)
  })

  it('words the hints of the review list', () => {
    expect(offlineHintText({ reason: 'pin_invalid', name: 'Anna', date: '2026-11-19', minutes: 478 }))
      .toBe('Offline-Stempel mit falscher PIN – bitte prüfen: Anna, 19.11.2026 07:58')
    expect(offlineHintText({ reason: 'not_clocked_in', name: 'Anna', date: '2026-11-19', minutes: 965 }))
      .toBe('Offline-Stempel „Geht“ ohne „Kommt“ – bitte prüfen: Anna, 19.11.2026 16:05')
    expect(offlineHintParts({ reason: 'too_old', date: '2026-11-01', minutes: 0 }))
      .toEqual({ before: 'Offline-Stempel älter als 7 Tage – bitte prüfen: ', after: ', 01.11.2026 00:00' })
    expect(de.terminal.offlineSaved('Anna', 'out', '16:05')).toBe('Gespeichert (offline) – Anna Geht 16:05')
    expect(de.terminal.offlinePending(3)).toBe('3 Stempel noch nicht übertragen')
    expect(de.time.clockSkew(-12)).toBe('Uhrzeit des Tablets wich ab (12 Min.)')
  })

  it('waits longer after each failed sync, at most 60 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(retryDelay)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000])
  })
})
