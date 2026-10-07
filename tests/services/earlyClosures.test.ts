import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  createEarlyClosure, deleteEarlyClosure, listEarlyClosures, updateEarlyClosure,
} from '../../server/services/earlyClosures'
import { createTestDb, errorCode } from '../helpers/fixtures'

describe('early closures', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('lists the closures of one year ordered by date', () => {
    createEarlyClosure(db, 1, { date: '2026-11-03', closedFrom: 840, reason: '  Personalausfall  ' })
    createEarlyClosure(db, 1, { date: '2026-10-15', closedFrom: 780, reason: 'Wasserschaden' })
    createEarlyClosure(db, 1, { date: '2027-01-12', closedFrom: 900, reason: 'Heizungsausfall' })
    expect(listEarlyClosures(db, 1, 2026).map(c => [c.date, c.closedFrom, c.reason])).toEqual([
      ['2026-10-15', 780, 'Wasserschaden'], ['2026-11-03', 840, 'Personalausfall'],
    ])
  })
  it('changes and deletes a closure', () => {
    const { id } = createEarlyClosure(db, 1, { date: '2026-10-15', closedFrom: 780, reason: 'Wasserschaden' })
    updateEarlyClosure(db, 1, id, { date: '2026-10-16', closedFrom: 800, reason: 'Personalausfall' })
    expect(listEarlyClosures(db, 1, 2026)).toEqual([{ id, date: '2026-10-16', closedFrom: 800, reason: 'Personalausfall' }])
    deleteEarlyClosure(db, 1, id)
    expect(listEarlyClosures(db, 1, 2026)).toEqual([])
  })
  it('requires a reason, one entry per day and existing entries', () => {
    expect(errorCode(() => createEarlyClosure(db, 1, { date: '2026-10-15', closedFrom: 780, reason: '  ' }))).toBe('reason_required')
    createEarlyClosure(db, 1, { date: '2026-10-15', closedFrom: 780, reason: 'Wasserschaden' })
    expect(errorCode(() => createEarlyClosure(db, 1, { date: '2026-10-15', closedFrom: 800, reason: 'x' }))).toBe('early_closure_exists')
    const { id } = createEarlyClosure(db, 1, { date: '2026-10-16', closedFrom: 780, reason: 'x' })
    expect(errorCode(() => updateEarlyClosure(db, 1, id, { date: '2026-10-15', closedFrom: 780, reason: 'x' }))).toBe('early_closure_exists')
    expect(errorCode(() => updateEarlyClosure(db, 1, 999, { date: '2026-10-20', closedFrom: 780, reason: 'x' }))).toBe('early_closure_not_found')
  })
})
