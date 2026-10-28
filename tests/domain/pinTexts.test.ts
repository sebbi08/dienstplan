import { describe, expect, it } from 'vitest'
import { pinFailureText, pinStateText } from '../../app/utils/pin'
import { mayManagePins } from '../../shared/domain/pin'
import type { PermissionKey } from '../../shared/domain/permissions'

/** A $fetch error as the service handler sends it. */
const failure = (code: string, details?: Record<string, unknown>) => ({ data: { data: { code, details } } })

describe('PIN texts at the tablet', () => {
  it('names the lock time when a try just locked the PIN', () => {
    expect(pinFailureText(failure('pin_locked', { lockedUntil: '2026-10-06T12:35:00.000Z', newLock: true })))
      .toBe('PIN für 15 Minuten gesperrt.')
    expect(pinFailureText(failure('pin_locked_long', { lockedUntil: '2026-10-06T12:50:00.000Z', newLock: true })))
      .toBe('PIN für 30 Minuten gesperrt.')
  })
  it('shows the end of a running lock instead of repeating the lock time', () => {
    expect(pinFailureText(failure('pin_locked', { lockedUntil: '2026-10-06T12:35:00.000Z', newLock: false })))
      .toBe('PIN gesperrt bis 14:35.')
    expect(pinFailureText(failure('pin_locked_long', { lockedUntil: '2026-10-06T23:05:00.000Z', newLock: false })))
      .toBe('PIN gesperrt bis 01:05.')
  })
  it('keeps the other texts', () => {
    expect(pinFailureText(failure('pin_locked_permanent', { lockedUntil: null, newLock: false })))
      .toBe('PIN gesperrt. Bitte die Leitung oder den Träger um Freischaltung.')
    expect(pinFailureText(failure('pin_invalid', { remaining: 3 }))).toBe('PIN falsch.')
    expect(pinFailureText(failure('pin_locked'))).toBe('PIN für 15 Minuten gesperrt.')
    expect(pinFailureText(new Error('offline'))).toBe('Das hat nicht geklappt. Bitte versuche es noch einmal.')
  })
})

describe('PIN state on the employee page', () => {
  const state = (pinLockLevel: number, pinLockedUntil: string | null = null) => pinStateText({
    hasPin: true, pinLockLevel, pinLockedUntil, pinLockedPermanently: pinLockLevel >= 3,
  })
  it('says nothing without locks or without a PIN', () => {
    expect(state(0)).toBeNull()
    expect(pinStateText({ hasPin: false, pinLockLevel: 0, pinLockedUntil: null, pinLockedPermanently: false })).toBeNull()
  })
  it('shows a running lock with what comes next', () => {
    expect(state(1, '2026-10-06T12:35:00.000Z')).toEqual({
      locked: true, text: 'PIN gesperrt bis 14:35. 1 Sperre seit der letzten richtigen Eingabe – die nächste dauert 30 Minuten.',
    })
  })
  it('keeps the escalation visible after a timed lock has expired', () => {
    expect(state(1)).toEqual({ locked: false, text: '1 Sperre seit der letzten richtigen Eingabe – die nächste dauert 30 Minuten.' })
    expect(state(2)).toEqual({ locked: false, text: '2 Sperren seit der letzten richtigen Eingabe – die nächste ist dauerhaft.' })
  })
  it('shows the lasting lock', () => {
    expect(state(3)).toEqual({ locked: true, text: 'PIN dauerhaft gesperrt – Freischaltung durch die Leitung oder den Träger nötig.' })
  })
})

describe('who sees the PIN controls on the employee page', () => {
  const none = () => false
  const all = (key: PermissionKey) => key === 'users.providerAccounts' || key === 'employees.edit'
  it('shows them to the Leitung and the Träger only, never to a Mitarbeiter with „pflegen“', () => {
    expect(mayManagePins('admin', none)).toBe(true)
    expect(mayManagePins('provider', all)).toBe(true)
    expect(mayManagePins('observer', key => key === 'employees.edit')).toBe(false)
    expect(mayManagePins('terminal', none)).toBe(false)
    expect(mayManagePins(undefined, none)).toBe(false)
  })
})
