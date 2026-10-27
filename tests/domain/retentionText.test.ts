import { describe, expect, it } from 'vitest'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import { archiveRetentionText } from '../../app/utils/retentionText'

describe('archiveRetentionText', () => {
  it('names the three dates and the entry last, as the spec words it', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2026-10-27')).toBe(
      'Zeitdaten werden am 01.01.2029 gelöscht, Beurteilungen am 01.01.2030, ausgezahlte Überstunden am 01.01.2037, danach der Eintrag.',
    )
  })

  it('follows the settings and lists the dates in their order', () => {
    const settings = { ...RETENTION_DEFAULTS, timeYears: 5, assessmentYears: 3, paidOvertimeYears: 12 }
    expect(archiveRetentionText('2026-03-15', settings, '2026-10-27')).toBe(
      'Beurteilungen werden am 01.01.2030 gelöscht, Zeitdaten am 01.01.2032, ausgezahlte Überstunden am 01.01.2039, danach der Eintrag.',
    )
  })

  it('says what is gone already and goes on with what is left', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2029-01-01')).toBe(
      'Zeitdaten sind schon gelöscht. Beurteilungen werden am 01.01.2030 gelöscht, ausgezahlte Überstunden am 01.01.2037, danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2031-06-01')).toBe(
      'Zeitdaten und Beurteilungen sind schon gelöscht. Ausgezahlte Überstunden werden am 01.01.2037 gelöscht, danach der Eintrag.',
    )
  })

  it('leaves out the paid overtime when nothing was paid out (the entry goes after the assessments)', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2026-10-27', false)).toBe(
      'Zeitdaten werden am 01.01.2029 gelöscht, Beurteilungen am 01.01.2030, danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2029-06-01', false)).toBe(
      'Zeitdaten sind schon gelöscht. Beurteilungen werden am 01.01.2030 gelöscht, danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2030-01-01', false)).toBe(
      'Alle Fristen sind abgelaufen: Der Eintrag wird beim nächsten täglichen Lauf gelöscht.',
    )
  })

  it('tells when every period has run out (the entry goes with the next daily run)', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2037-01-01')).toBe(
      'Alle Fristen sind abgelaufen: Der Eintrag wird beim nächsten täglichen Lauf gelöscht.',
    )
  })
})
