import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { askRecognitionYear, contractSummary, levelYearsNote } from '../../app/utils/contract'
import { errorMessage } from '../../app/utils/errors'
import type { EmployeeContractDto } from '../../shared/types/api'

const contract: EmployeeContractDto = {
  personnelNumber: null, employedSince: '2021-09-01', jobKey: null, jobOther: null, payGroup: 'S 8a', payLevel: 2,
  fixedTermUntil: null, trainingUntil: null, recognitionYearCounts: false,
}

describe('contract: level years after a training in the facility', () => {
  it('says nothing while the level years start with the employment', () => {
    expect(levelYearsNote(contract)).toBeNull()
    expect(levelYearsNote({ ...contract, employedSince: null, trainingUntil: '2024-07-31' })).toBeNull()
    expect(levelYearsNote({ ...contract, employedSince: '2024-09-01', trainingUntil: '2024-07-31' })).toBeNull()
    expect(levelYearsNote({ ...contract, employedSince: '2024-01-01', trainingUntil: '2024-07-31', recognitionYearCounts: true })).toBeNull()
  })
  it('names the start and why it differs', () => {
    expect(levelYearsNote({ ...contract, trainingUntil: '2024-07-31' })).toBe('Stufenjahre ab 01.08.2024 (nach Ausbildung)')
    expect(levelYearsNote({ ...contract, trainingUntil: '2024-07-31', recognitionYearCounts: true }))
      .toBe('Stufenjahre ab 01.08.2023 (Anerkennungsjahr als Stufe 1)')
    expect(contractSummary({ ...contract, trainingUntil: '2024-07-31' }, '2026-11-18'))
      .toBe('S 8a, Stufe 2 · seit 01.09.2021 (5 J. 2 Mon.) · Stufenjahre ab 01.08.2024 (nach Ausbildung)')
  })
  it('asks about the recognition year when a valid training end is entered or changed', () => {
    const today = '2026-11-18'
    expect(askRecognitionYear(null, '2024-07-31', today)).toBe(true)
    expect(askRecognitionYear('2024-06-30', '2024-07-31', today)).toBe(true)
    expect(askRecognitionYear('2024-07-31', '2024-07-31', today)).toBe(false)
    expect(askRecognitionYear('2024-07-31', null, today)).toBe(false)
    expect(askRecognitionYear(null, null, today)).toBe(false)
    // A date the server refuses is not asked about (the save then shows the German error).
    expect(askRecognitionYear(null, '2027-11-18', today)).toBe(true)
    for (const invalid of ['2027-11-19', '1969-12-31', '2024-02-30', '31.07.2024', '']) {
      expect(askRecognitionYear(null, invalid, today), invalid).toBe(false)
    }
  })
  it('names the suggested level by the level years', () => {
    expect(de.contract.levelHint(2, 3, '01.08.2026')).toBe('Nach Stufenjahren: Stufe 2, Stufe 3 ab 01.08.2026')
    expect(de.contract.levelHint(6, null, null)).toBe('Nach Stufenjahren: Stufe 6 (Endstufe)')
  })
  it('has the German texts of the question and the date check', () => {
    expect(de.contract.recognitionQuestion).toBe('Zählt das Anerkennungsjahr als Stufe 1? Dann ist das erste Jahr nach der Ausbildung Stufe 2.')
    expect([de.contract.recognitionYes, de.contract.recognitionNo]).toEqual(['Ja, Anerkennungsjahr zählt', 'Nein'])
    expect([de.contract.trainingUntil, de.contract.recognitionYearCounts]).toEqual(['Ausbildung/Studium hier bis', 'Anerkennungsjahr zählt als Stufe 1'])
    expect(errorMessage({ data: { data: { code: 'training_until_invalid' } } })).toBe(de.errors.training_until_invalid)
    expect(de.errors.training_until_invalid).toContain('Ausbildung/Studium hier bis')
  })
})
