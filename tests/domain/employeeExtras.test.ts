import { describe, expect, it } from 'vitest'
import { dueMonthYear, forfeitText, levelText, levelToTake, levelTone, probationText, requirementBadge } from '../../app/utils/employeeExtras'

describe('the texts of the employee list columns', () => {
  it('shows „in Probezeit bis …“ only while the server sends the day (a running probation period)', () => {
    expect(probationText({ probationUntil: '2027-02-28' })).toBe('in Probezeit bis 28.02.')
    expect(probationText({ probationUntil: null })).toBeNull()
    expect(probationText({})).toBeNull()
    expect(probationText(undefined)).toBeNull()
  })

  const next = (state: 'later' | 'soon' | 'overdue') => ({ final: false as const, fromLevel: 3, level: 4, on: '2027-02-01', state })

  it('names the next level with its day, or the top level', () => {
    expect(levelText(next('later'))).toBe('Stufe 4 ab 01.02.2027')
    expect(levelText({ final: true })).toBe('Endstufe')
  })
  it('is amber within a month, red when overdue, plain otherwise; „übernehmen“ only then', () => {
    expect([levelTone(next('later')), levelTone(next('soon')), levelTone(next('overdue')), levelTone({ final: true })])
      .toEqual(['neutral', 'warning', 'error', 'neutral'])
    expect([levelToTake(next('later')), levelToTake(next('soon')), levelToTake(next('overdue')), levelToTake({ final: true })])
      .toEqual([null, 4, 4, null])
  })
  it('writes an appointment by its state: overdue and missing red, soon amber with the month', () => {
    expect(dueMonthYear('2026-12-20')).toBe('12.2026')
    expect(requirementBadge({ typeId: 1, typeName: 'Betriebsarzt', state: 'overdue', dueOn: '2026-01-10' }))
      .toEqual({ text: 'Betriebsarzt überfällig', tone: 'error' })
    expect(requirementBadge({ typeId: 4, typeName: 'Masernimpfung (Nachweis)', state: 'missing', dueOn: null }))
      .toEqual({ text: 'Masernimpfung (Nachweis) fehlt', tone: 'error' })
    expect(requirementBadge({ typeId: 2, typeName: 'Erste-Hilfe-Kurs', state: 'soon', dueOn: '2026-12-20' }))
      .toEqual({ text: 'Erste-Hilfe-Kurs bis 12.2026', tone: 'warning' })
  })
  it('words the leave notice, nothing outside the window', () => {
    expect(forfeitText(undefined, 2026)).toBeNull()
    expect(forfeitText(null, 2026)).toBeNull()
    expect(forfeitText({ year: 2026, status: 'read', readAt: '2026-11-19T10:00:00Z' }, 2026)).toBe('Hinweis gelesen am 19.11.2026')
    expect(forfeitText({ year: 2026, status: 'open', readAt: null }, 2026)).toBe('Hinweis offen')
    expect(forfeitText({ year: 2026, status: 'no_account', readAt: null }, 2026)).toBe('kein Konto – schriftlich hinweisen')
    // The notice is about one year: beside another year's leave the line stays away.
    expect(forfeitText({ year: 2026, status: 'open', readAt: null }, 2027)).toBeNull()
  })
})
