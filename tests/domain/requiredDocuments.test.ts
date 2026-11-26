import { describe, expect, it } from 'vitest'
import {
  REQUIRED_DOCUMENT_EXAMPLES, REQUIRED_DOCUMENT_FOLDER, appliesToEmployee, defaultRequiredFolder, parseAppliesTo, requiredDocumentStatus,
  serializeAppliesTo,
} from '../../shared/domain/requiredDocuments'
import type { RequiredDocumentTypeDto } from '../../shared/types/api'
import { keptRequiredType } from '../../app/utils/requiredDocuments'

describe('Pflichtdokumente (shared rules)', () => {
  it('keeps the preset type of „Zum Unterschreiben senden“ until the types are loaded, then only an active one of the folder', () => {
    const type = (id: number, folder: RequiredDocumentTypeDto['folder'], active = true): RequiredDocumentTypeDto => ({
      id, name: `T${id}`, folder, appliesTo: 'all', validityMonths: null, templateId: null, templateTitle: null, active,
    })
    // Opened from the box: the folder is set before the types arrive – the preset stays.
    expect(keptRequiredType(null, 'contract', 5)).toBe(5)
    const types = [type(5, 'contract'), type(6, 'salary'), type(7, 'contract', false)]
    expect(keptRequiredType(types, 'contract', 5)).toBe(5)
    expect(keptRequiredType(types, 'salary', 5)).toBe(0)
    expect(keptRequiredType(types, 'contract', 7)).toBe(0)
    expect(keptRequiredType([], 'contract', 5)).toBe(0)
  })

  it('has the agreed examples, all in „Pflichtdokumente“ but the Arbeitsvertrag, the Führungszeugnis for 5 years and Erste Hilfe for 2', () => {
    expect(REQUIRED_DOCUMENT_EXAMPLES.map(example => [example.name, example.folder, example.validityMonths])).toEqual([
      ['Arbeitsvertrag', 'contract', null],
      ['Erweitertes Führungszeugnis', 'required', 60],
      ['Masernnachweis', 'required', null],
      ['Belehrung Infektionsschutz', 'required', null],
      ['Verpflichtung auf den Datenschutz', 'required', null],
      ['Erste-Hilfe-Nachweis', 'required', 24],
      ['Schweigepflichterklärung', 'required', null],
    ])
  })

  it('presets a new type to „Pflichtdokumente“ if the editor may use it, else to their first folder', () => {
    expect(REQUIRED_DOCUMENT_FOLDER).toBe('required')
    expect(defaultRequiredFolder(['contract', 'application', 'required', 'qualifications'])).toBe('required')
    expect(defaultRequiredFolder(['qualifications', 'salary'])).toBe('qualifications')
    expect(defaultRequiredFolder([])).toBeNull()
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
