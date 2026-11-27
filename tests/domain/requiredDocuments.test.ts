import { describe, expect, it } from 'vitest'
import {
  REQUIRED_DOCUMENT_EXAMPLES, REQUIRED_DOCUMENT_FOLDER, appliesToEmployee, defaultRequiredFolder, inspectionDateError, inspectionDeadline,
  inspectionOverdue, inspectionStatus, isCertificateType, parseAppliesTo, requiredDocumentStatus, serializeAppliesTo,
} from '../../shared/domain/requiredDocuments'
import type { RequiredDocumentTypeDto } from '../../shared/types/api'
import { filesSignedCopy, keptRequiredType } from '../../app/utils/requiredDocuments'

describe('Pflichtdokumente (shared rules)', () => {
  it('keeps the preset type of „Zum Unterschreiben senden“ until the types are loaded, then only an active file type of the folder', () => {
    const type = (id: number, folder: RequiredDocumentTypeDto['folder'], active = true, mode: RequiredDocumentTypeDto['mode'] = 'file'): RequiredDocumentTypeDto => ({
      id, name: `T${id}`, folder, appliesTo: 'all', validityMonths: null, templateId: null, templateTitle: null, active, mode,
    })
    // Opened from the box: the folder is set before the types arrive – the preset stays.
    expect(keptRequiredType(null, 'contract', 5)).toBe(5)
    const types = [type(5, 'contract'), type(6, 'salary'), type(7, 'contract', false), type(8, 'required', true, 'inspection')]
    expect(keptRequiredType(types, 'contract', 5)).toBe(5)
    expect(keptRequiredType(types, 'salary', 5)).toBe(0)
    expect(keptRequiredType(types, 'contract', 7)).toBe(0)
    expect(keptRequiredType([], 'contract', 5)).toBe(0)
    // A type „nur Einsicht vermerken“ (the Führungszeugnis) is never offered: it takes no signed copy.
    expect(keptRequiredType(types, 'required', 8)).toBe(0)
    expect(types.filter(entry => filesSignedCopy(entry, 'required'))).toEqual([])
  })

  it('names § 72a only for a Führungszeugnis, and sets the deadline of an inspection record', () => {
    expect(isCertificateType(' Erweitertes FÜHRUNGSZEUGNIS ')).toBe(true)
    expect(isCertificateType('Führungszeugnis (Ehrenamt)')).toBe(true)
    expect(isCertificateType('Masernnachweis')).toBe(false)
    // Deletable the day after leaving, gone by 3 months after it; not taken up: at once, overdue as soon as listed.
    expect(inspectionDeadline('2026-03-15', '2020-01-01')).toEqual({ deletableFrom: '2026-03-16', deleteBy: '2026-06-15' })
    expect(inspectionDeadline('2026-03-15', null)).toEqual({ deletableFrom: '2026-03-16', deleteBy: '2026-06-15' })
    expect(inspectionDeadline('2026-03-15', '2026-04-01')).toEqual({ deletableFrom: '2026-03-16', deleteBy: null })
    expect(inspectionOverdue('2026-06-15', '2026-06-15')).toBe(false)
    expect(inspectionOverdue('2026-06-15', '2026-06-16')).toBe(true)
    expect(inspectionOverdue(null, '2026-03-16')).toBe(true)
  })

  it('runs the validity of an inspection from the certificate\'s date and checks both dates', () => {
    expect(inspectionStatus(60, { certificateDate: '2026-08-01', noRelevantEntry: true }, '2026-11-20'))
      .toEqual({ state: 'present', date: '2026-08-01', expiresOn: '2031-08-01' })
    expect(inspectionStatus(60, { certificateDate: '2026-08-01', noRelevantEntry: false }, '2026-11-20'))
      .toEqual({ state: 'entry', date: '2026-08-01', expiresOn: null })
    expect(inspectionDateError('2026-08-01', null, '2026-11-20')).toBeNull()
    expect(inspectionDateError('2026-08-01', '2026-11-20', '2026-11-20')).toBeNull()
    expect(inspectionDateError('2026-11-21', null, '2026-11-20')).toBe('certificate_date_future')
    expect(inspectionDateError('2026-02-30', null, '2026-11-20')).toBe('certificate_date_invalid')
    expect(inspectionDateError('2026-08-01', '2026-11-21', '2026-11-20')).toBe('inspection_date_future')
    expect(inspectionDateError('2026-08-01', '2026-07-31', '2026-11-20')).toBe('inspection_before_certificate')
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
