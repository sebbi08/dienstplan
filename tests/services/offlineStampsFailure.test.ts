import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { listOfflineStampHints, syncOfflineStamps } from '../../server/services/offlineStamps'
import { setPin } from '../../server/services/terminal'
import { loadTimeRecords } from '../../server/services/timeTracking'
import { addEmployee, createTestDb } from '../helpers/fixtures'

/** The employee whose stamps make the server fail (a stand-in for any unexpected error while handling one stamp). */
const failing = vi.hoisted(() => ({ id: -1 }))
vi.mock('../../server/services/queries', async (original) => {
  const actual = await original<typeof import('../../server/services/queries')>()
  return {
    ...actual,
    loadEmployee: (...args: Parameters<typeof actual.loadEmployee>) => {
      if (args[1] === failing.id) throw new Error('boom')
      return actual.loadEmployee(...args)
    },
  }
})

const NOW = new Date('2026-11-19T09:00:00Z')
let db: Db

beforeEach(() => {
  db = createTestDb()
})

describe('a stamp the server fails to handle', () => {
  it('goes to the review list and does not hold up the other stamps of the batch', () => {
    const anna = addEmployee(db, 'Anna')
    const berta = addEmployee(db, 'Berta')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '123456')
    setPin(db, 1, berta, '654321')
    failing.id = anna
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stamp = (employeeId: number, clientId: string, pin: string) => ({
      clientId, employeeId, pin, action: 'in' as const, stampedAt: '2026-11-19T08:00:00+01:00',
    })
    const { results } = syncOfflineStamps(db, 1, {
      clientNow: NOW.toISOString(), stamps: [stamp(anna, 'client-anna-1', '123456'), stamp(berta, 'client-berta-1', '654321')],
    }, NOW)
    expect(results).toEqual([
      { clientId: 'client-anna-1', status: 'review', reason: 'failed' },
      { clientId: 'client-berta-1', status: 'recorded', reason: null },
    ])
    expect(loadTimeRecords(db, { employeeId: berta })).toHaveLength(1)
    expect(listOfflineStampHints(db, 1)).toEqual([expect.objectContaining({ employeeId: anna, reason: 'failed' })])
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })
})
