import { describe, expect, it } from 'vitest'
import {
  REQUIRED_DOCUMENT_EXAMPLES, appliesToEmployee, parseAppliesTo, requiredDocumentStatus, serializeAppliesTo,
} from '../../shared/domain/requiredDocuments'

describe('Pflichtdokumente (shared rules)', () => {
  it('has the agreed examples, each in a folder, the Führungszeugnis for 5 years and Erste Hilfe for 2', () => {
    expect(REQUIRED_DOCUMENT_EXAMPLES.map(example => [example.name, example.folder, example.validityMonths])).toEqual([
      ['Arbeitsvertrag', 'contract', null],
      ['Erweitertes Führungszeugnis', 'application', 60],
      ['Masernnachweis', 'application', null],
      ['Belehrung Infektionsschutz', 'qualifications', null],
      ['Verpflichtung auf den Datenschutz', 'contract', null],
      ['Erste-Hilfe-Nachweis', 'qualifications', 24],
      ['Schweigepflichterklärung', 'contract', null],
    ])
  })

  it('applies a type to everyone or to the chosen qualifications (none entered: only the types for everyone)', () => {
    expect(parseAppliesTo('all')).toBe('all')
    expect(parseAppliesTo('["fachkraft","praktikant"]')).toEqual(['fachkraft', 'praktikant'])
    // Anything unreadable counts as everyone (never hides a type by accident); unknown keys are dropped.
    expect(parseAppliesTo('kaputt')).toBe('all')
    expect(parseAppliesTo('["fachkraft","unbekannt"]')).toEqual(['fachkraft'])
    expect(serializeAppliesTo('all')).toBe('all')
    expect(serializeAppliesTo(['praktikant', 'fachkraft', 'fachkraft'])).toBe('["fachkraft","praktikant"]')
    expect(serializeAppliesTo([])).toBe('all')
    expect([appliesToEmployee('all', null), appliesToEmployee(['fachkraft'], 'fachkraft'), appliesToEmployee(['fachkraft'], 'azubi_1'), appliesToEmployee(['fachkraft'], null)])
      .toEqual([true, true, false, false])
  })

  it('tells missing, present, expiring within 2 months of the end of validity and expired', () => {
    const today = '2026-11-25'
    expect(requiredDocumentStatus(null, null, today)).toEqual({ state: 'missing', date: null, expiresOn: null })
    expect(requiredDocumentStatus(null, '2020-01-01', today)).toEqual({ state: 'present', date: '2020-01-01', expiresOn: null })
    expect(requiredDocumentStatus(60, '2024-01-10', today)).toEqual({ state: 'present', date: '2024-01-10', expiresOn: '2029-01-10' })
    expect(requiredDocumentStatus(24, '2025-01-25', today)).toEqual({ state: 'expiring', date: '2025-01-25', expiresOn: '2027-01-25' })
    expect(requiredDocumentStatus(24, '2024-11-25', today)).toEqual({ state: 'expired', date: '2024-11-25', expiresOn: '2026-11-25' })
    expect(requiredDocumentStatus(24, '2025-01-26', today).state).toBe('present')
    expect(requiredDocumentStatus(24, null, today)).toEqual({ state: 'missing', date: null, expiresOn: null })
  })
})
