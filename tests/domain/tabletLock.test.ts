import { describe, expect, it } from 'vitest'
import { lockNeedsRetry } from '../../app/utils/tabletLock'
import { isPlanEditorView } from '../../app/utils/routeAccess'
import { PLAN_EDIT_MAX_LOCK_MINUTES, unlockLockMinutes } from '../../shared/domain/tablet'

describe('the tablet\'s lock until the server confirms it', () => {
  it('sends it again without an answer, after a server error or „too many requests“, not after a refusal', () => {
    expect(lockNeedsRetry(new TypeError('Failed to fetch'))).toBe(true)
    expect(lockNeedsRetry({ status: 0 })).toBe(true)
    for (const status of [500, 502, 503, 504, 429]) expect(lockNeedsRetry({ statusCode: status }), String(status)).toBe(true)
    // The server answered: no tablet session (any more), nothing to lock.
    for (const status of [401, 403, 404]) expect(lockNeedsRetry({ statusCode: status }), String(status)).toBe(false)
  })
})

describe('the plan editor\'s view at the tablet', () => {
  it('is a plan page with ?editor=1, never the tile\'s view, the printout or another page', () => {
    expect(isPlanEditorView('/plan/2026/11', { editor: '1' })).toBe(true)
    expect(isPlanEditorView('/plan/2026/11', {})).toBe(false)
    expect(isPlanEditorView('/plan/2026/11', { editor: 'true' })).toBe(false)
    expect(isPlanEditorView('/print/2026/11', { editor: '1' })).toBe(false)
    expect(isPlanEditorView('/children', { editor: '1' })).toBe(false)
  })

  it('locks after the facility\'s lock time, while editing after at most 5 minutes', () => {
    expect(PLAN_EDIT_MAX_LOCK_MINUTES).toBe(5)
    expect(unlockLockMinutes(30, false)).toBe(30)
    expect(unlockLockMinutes(30, true)).toBe(5)
    expect(unlockLockMinutes(2, true)).toBe(2)
  })
})
