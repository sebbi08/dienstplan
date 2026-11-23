import { describe, expect, it } from 'vitest'
import { moveArea, moveInList, moveQuestion } from '../../app/utils/consentSettings'
import {
  BUILTIN_CONSENT_KEYS, CONSENT_AREA_MAX, CONSENT_SHORT_MAX, CONSENT_TEXT_MAX, DEFAULT_CONSENT_QUESTIONS, DEFAULT_OVERVIEW_SHEETS,
  OVERVIEW_FIELD_KEYS, SHEET_NAME_MAX, consentAreas, groupByArea,
} from '../../shared/domain/childConsents'

const questions = [
  { id: 1, area: 'Datenschutz' }, { id: 2, area: 'Datenschutz' }, { id: 5, area: 'Messenger' }, { id: 3, area: 'Datenschutz' },
  { id: 4, area: 'Gesundheit' },
]

describe('order of the consent questions in the settings', () => {
  it('orders the areas by their first question and keeps the questions in their order', () => {
    expect(consentAreas(questions)).toEqual(['Datenschutz', 'Messenger', 'Gesundheit'])
    expect(groupByArea(questions).map(block => [block.area, block.questions.map(question => question.id)])).toEqual([
      ['Datenschutz', [1, 2, 3]], ['Messenger', [5]], ['Gesundheit', [4]],
    ])
  })

  it('moves a question past its neighbour of the same area only', () => {
    expect(moveQuestion(questions, 3, -1)).toEqual([1, 3, 5, 2, 4])
    expect(moveQuestion(questions, 2, 1)).toEqual([1, 3, 5, 2, 4])
    expect(moveQuestion(questions, 1, -1)).toBeNull()
    expect(moveQuestion(questions, 5, 1)).toBeNull()
    expect(moveQuestion(questions, 99, 1)).toBeNull()
  })

  it('moves a whole area among the areas', () => {
    expect(moveArea(questions, 'Gesundheit', -1)).toEqual([1, 2, 3, 4, 5])
    expect(moveArea(questions, 'Datenschutz', 1)).toEqual([5, 1, 2, 3, 4])
    expect(moveArea(questions, 'Datenschutz', -1)).toBeNull()
    expect(moveArea(questions, 'Gesundheit', 1)).toBeNull()
  })

  it('moves an entry of a plain list', () => {
    expect(moveInList(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveInList(['a', 'b', 'c'], 0, -1)).toBeNull()
    expect(moveInList(['a', 'b', 'c'], 2, 1)).toBeNull()
  })
})

describe('the default questions and tabs of a facility', () => {
  it('ask each former fixed consent once, within the lengths a facility may type', () => {
    expect(DEFAULT_CONSENT_QUESTIONS.map(question => question.builtinKey)).toEqual([...BUILTIN_CONSENT_KEYS])
    for (const question of DEFAULT_CONSENT_QUESTIONS) {
      expect(question.text.length).toBeLessThanOrEqual(CONSENT_TEXT_MAX)
      expect(question.short.length).toBeLessThanOrEqual(CONSENT_SHORT_MAX)
      expect(question.area.length).toBeLessThanOrEqual(CONSENT_AREA_MAX)
    }
    expect(consentAreas(DEFAULT_CONSENT_QUESTIONS)).toEqual(['Datenschutz', 'Messenger (WhatsApp, Signal)', 'Gesundheit'])
  })

  it('show every question in exactly one tab and only known fields, each tab name valid', () => {
    const keys = DEFAULT_OVERVIEW_SHEETS.flatMap(sheet => sheet.columns).flatMap(column => (column.type === 'consent' ? [column.builtinKey] : []))
    expect([...keys].sort()).toEqual([...BUILTIN_CONSENT_KEYS].sort())
    for (const sheet of DEFAULT_OVERVIEW_SHEETS) {
      expect(sheet.name.length).toBeLessThanOrEqual(SHEET_NAME_MAX)
      for (const column of sheet.columns) if (column.type === 'field') expect(OVERVIEW_FIELD_KEYS).toContain(column.key)
    }
  })
})
