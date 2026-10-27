import { describe, expect, it } from 'vitest'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import { archiveRetentionText } from '../../app/utils/retentionText'

describe('archiveRetentionText', () => {
  it('names the three dates and the entry last, as the spec words it', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2026-10-27')).toBe(
      'Zeitdaten dürfen ab 01.01.2029 gelöscht werden, Beurteilungen ab 01.01.2030, ausgezahlte Überstunden ab 01.01.2037; danach der Eintrag.',
    )
  })

  it('follows the settings and lists the dates in their order', () => {
    const settings = { ...RETENTION_DEFAULTS, timeYears: 5, assessmentYears: 3, paidOvertimeYears: 12 }
    expect(archiveRetentionText('2026-03-15', settings, '2026-10-27')).toBe(
      'Beurteilungen dürfen ab 01.01.2030 gelöscht werden, Zeitdaten ab 01.01.2032, ausgezahlte Überstunden ab 01.01.2039; danach der Eintrag.',
    )
  })

  it('says what may be deleted already and goes on with what is left', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2029-01-01')).toBe(
      'Zeitdaten dürfen schon gelöscht werden. Beurteilungen dürfen ab 01.01.2030 gelöscht werden, ausgezahlte Überstunden ab 01.01.2037; danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2031-06-01')).toBe(
      'Zeitdaten und Beurteilungen dürfen schon gelöscht werden. Ausgezahlte Überstunden dürfen ab 01.01.2037 gelöscht werden; danach der Eintrag.',
    )
  })

  it('leaves out the paid overtime when nothing was paid out (the entry goes after the assessments)', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2026-10-27', false)).toBe(
      'Zeitdaten dürfen ab 01.01.2029 gelöscht werden, Beurteilungen ab 01.01.2030; danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2029-06-01', false)).toBe(
      'Zeitdaten dürfen schon gelöscht werden. Beurteilungen dürfen ab 01.01.2030 gelöscht werden; danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2030-01-01', false)).toBe(
      'Alle Fristen sind abgelaufen: Der Eintrag darf gelöscht werden.',
    )
  })

  it('tells when every period has run out (the entry may be deleted then)', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2037-01-01')).toBe(
      'Alle Fristen sind abgelaufen: Der Eintrag darf gelöscht werden.',
    )
  })
})
