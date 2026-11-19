import { describe, expect, it } from 'vitest'
import {
  BEM_DEFAULT_INVITATION_TEXT, bemAnswerBy, bemEndDate, bemLimit, bemSickLevel, bemWindow, countBemSickDays, fillBemInvitationText,
  isBemOpen,
} from '../../shared/domain/bem'
import { dateRange, weekday } from '../../shared/domain/dates'

const monToFri = (date: string) => weekday(date) < 5

describe('BEM limit (more than 6 weeks of working days)', () => {
  it('is six times the working days per week, half values rounded up', () => {
    expect(bemLimit(5)).toBe(30)
    expect(bemLimit(4)).toBe(24)
    expect(bemLimit(3)).toBe(18)
    expect(bemLimit(2.5)).toBe(15)
    expect(bemLimit(2.25)).toBe(14)
    expect(bemLimit(1)).toBe(6)
  })
})

describe('BEM window (rolling 12 months)', () => {
  it('runs from today − 365 days + 1 to today', () => {
    expect(bemWindow('2026-11-19', null)).toEqual({ from: '2025-11-20', to: '2026-11-19' })
  })
  it('starts the day after the last declined or completed BEM when that is later', () => {
    expect(bemWindow('2026-11-19', '2026-03-31')).toEqual({ from: '2026-04-01', to: '2026-11-19' })
    expect(bemWindow('2026-11-19', '2024-03-31')).toEqual({ from: '2025-11-20', to: '2026-11-19' })
  })
})

describe('counting sick working days', () => {
  it('counts each sick working day of the window once', () => {
    const window = bemWindow('2026-11-19', null)
    const days = ['2025-11-19', '2025-11-20', '2025-11-21', '2025-11-22', '2026-11-19', '2026-11-19', '2026-11-20']
    // 19.11.2025 is before the window, 22.11.2025 a Saturday, 20.11.2026 after today; 19.11.2026 twice counts once.
    expect(countBemSickDays(days, monToFri, window)).toBe(3)
  })
  it('counts only days after the restart', () => {
    const sick = dateRange('2026-01-05', '2026-03-27')
    expect(countBemSickDays(sick, monToFri, bemWindow('2026-11-19', null))).toBe(60)
    expect(countBemSickDays(sick, monToFri, bemWindow('2026-11-19', '2026-02-27'))).toBe(20)
  })
})

describe('the level of the line on the employee page', () => {
  it('is amber from 80 % of the limit and red above it', () => {
    expect(bemSickLevel(0, 30)).toBe('ok')
    expect(bemSickLevel(23, 30)).toBe('ok')
    expect(bemSickLevel(24, 30)).toBe('warn')
    expect(bemSickLevel(30, 30)).toBe('warn')
    expect(bemSickLevel(31, 30)).toBe('over')
  })
})

describe('process states', () => {
  it('knows the open states and the end date', () => {
    expect(isBemOpen('invited')).toBe(true)
    expect(isBemOpen('accepted')).toBe(true)
    for (const status of ['declined', 'no_answer', 'completed'] as const) expect(isBemOpen(status)).toBe(false)
    expect(bemEndDate({ status: 'completed', completedOn: '2026-05-04' })).toBe('2026-05-04')
    expect(bemEndDate({ status: 'accepted', completedOn: null })).toBeNull()
  })
  it('asks for an answer within 14 days', () => {
    expect(bemAnswerBy('2026-11-19')).toBe('2026-12-03')
  })
})

describe('the invitation text', () => {
  it('covers occasion, aim, voluntariness, participants, data protection and the answer date', () => {
    for (const part of ['§ 167 Abs. 2 SGB IX', 'sechs Wochen', 'freiwillig', 'keine Nachteile', 'jederzeit widerrufen',
      'Betriebsarzt', 'Personalvertretung', 'Schwerbehindertenvertretung', 'Zustimmung', 'getrennt von der Personalakte',
      '‹Antwort bis›', '‹Jahre›']) {
      expect(BEM_DEFAULT_INVITATION_TEXT, part).toContain(part)
    }
  })
  it('fills in the name, the answer date and the years until deletion', () => {
    expect(fillBemInvitationText('Hallo ‹Name›, bis ‹Antwort bis›; Löschung ‹Jahre› Jahre', {
      name: 'Anna Muster', answerBy: '2026-12-03', years: 3,
    })).toBe('Hallo Anna Muster, bis 03.12.2026; Löschung 3 Jahre')
  })
})
