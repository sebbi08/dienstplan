import { describe, expect, it } from 'vitest'
import {
  finishedAt, isOverdue, parseRecipientIds, signatureFooter, signedDocumentTitle, signRequestExpired, writtenFormHint,
} from '../../shared/domain/signRequests'

describe('requests to sign: shared rules', () => {
  it('warns for titles that suggest the written form, whatever the spelling', () => {
    for (const title of ['Kündigung zum 31.12.', 'kuendigung', 'Befristung des Vertrags', 'Arbeitsvertrag Anna', 'Arbeitszeugnis',
      'Zwischenzeugnis', 'Aufhebungsvertrag', 'Verlängerung der befristeten Anstellung']) {
      expect(writtenFormHint(title), title).toBe(true)
    }
    for (const title of ['Belehrung § 34 IfSG', 'Datenschutzerklärung', 'Schweigepflicht', '']) expect(writtenFormHint(title), title).toBe(false)
  })

  it('names the signed copy and writes the footer in Berlin time', () => {
    // 23:30 UTC is already the next day in Berlin (winter time).
    const at = new Date('2026-11-24T23:30:00Z')
    expect(signedDocumentTitle('  Belehrung  ', at)).toBe('Belehrung – unterschrieben am 25.11.2026')
    expect(signedDocumentTitle('x'.repeat(300), at)).toHaveLength(200)
    expect(signatureFooter(' Anna Probe ', at)).toBe('Elektronisch unterschrieben von Anna Probe am 25.11.2026 00:30')
    expect(signatureFooter('Ben', new Date('2026-07-01T07:05:00Z'))).toBe('Elektronisch unterschrieben von Ben am 01.07.2026 09:05')
  })

  it('is overdue from the day after the due date, only while open', () => {
    expect(isOverdue('2026-11-24', '2026-11-24')).toBe(false)
    expect(isOverdue('2026-11-24', '2026-11-25')).toBe(true)
    expect(isOverdue('2026-11-24', '2026-11-25', 'signed')).toBe(false)
    expect(isOverdue(null, '2030-01-01')).toBe(false)
  })

  it('knows when a recipient finished and when a request may be deleted (one year after the last one)', () => {
    const open = { status: 'open' as const, signedAt: null, declinedAt: null, withdrawnAt: null }
    const signed = { ...open, status: 'signed' as const, signedAt: '2025-11-20T10:00:00.000Z' }
    const declined = { ...open, status: 'declined' as const, declinedAt: '2025-11-23T10:00:00.000Z' }
    const withdrawn = { ...open, status: 'withdrawn' as const, withdrawnAt: '2025-11-01T10:00:00.000Z' }
    expect([open, signed, declined, withdrawn].map(finishedAt)).toEqual([null, signed.signedAt, declined.declinedAt, withdrawn.withdrawnAt])
    const now = new Date('2026-11-22T12:00:00.000Z')
    expect(signRequestExpired('2025-01-01T00:00:00.000Z', [signed, withdrawn], now)).toBe(true)
    // The last one finished less than a year ago.
    expect(signRequestExpired('2025-01-01T00:00:00.000Z', [signed, declined], now)).toBe(false)
    expect(signRequestExpired('2025-01-01T00:00:00.000Z', [signed, open], now)).toBe(false)
    // No recipients left (deleted with their employees): a year after it was sent.
    expect(signRequestExpired('2025-11-01T00:00:00.000Z', [], now)).toBe(true)
    expect(signRequestExpired('2026-01-01T00:00:00.000Z', [], now)).toBe(false)
  })

  it('reads the recipients of a form field', () => {
    expect(parseRecipientIds('3, 5,8,3')).toEqual([3, 5, 8])
    expect(parseRecipientIds('')).toBeNull()
    expect(parseRecipientIds('3,x')).toBeNull()
    expect(parseRecipientIds('0')).toBeNull()
  })
})
