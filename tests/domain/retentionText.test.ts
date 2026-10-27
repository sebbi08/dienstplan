import { describe, expect, it } from 'vitest'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import { archiveRetentionText } from '../../app/utils/retentionText'

const PERSONAL = 'Persönliche Daten dürfen schon gelöscht werden (vom Träger unter Mehr → Löschfristen).'
const ALL_DONE = 'Alle Fristen sind abgelaufen. Der Träger löscht die Daten unter Mehr → Löschfristen; sobald alles andere gelöscht ist, auch den Eintrag.'

describe('archiveRetentionText', () => {
  it('names the personal data, the three dates and the entry last, as the spec words it', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2026-10-27')).toBe(
      `${PERSONAL} Zeitdaten dürfen ab 01.01.2029 gelöscht werden, Beurteilungen ab 01.01.2030, ausgezahlte Überstunden ab 01.01.2037; danach der Eintrag.`,
    )
  })

  it('dates the personal data the day after leaving while that day has not come yet', () => {
    expect(archiveRetentionText('2026-10-27', RETENTION_DEFAULTS, '2026-10-27')).toBe(
      'Persönliche Daten dürfen ab 28.10.2026 gelöscht werden, Zeitdaten ab 01.01.2029, Beurteilungen ab 01.01.2030, ausgezahlte Überstunden ab 01.01.2037; danach der Eintrag.',
    )
  })

  it('follows the settings and lists the dates in their order', () => {
    const settings = { ...RETENTION_DEFAULTS, timeYears: 5, assessmentYears: 3, paidOvertimeYears: 12 }
    expect(archiveRetentionText('2026-03-15', settings, '2026-10-27')).toBe(
      `${PERSONAL} Beurteilungen dürfen ab 01.01.2030 gelöscht werden, Zeitdaten ab 01.01.2032, ausgezahlte Überstunden ab 01.01.2039; danach der Eintrag.`,
    )
  })

  it('says what may be deleted already and goes on with what is left', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2029-01-01')).toBe(
      'Persönliche Daten und Zeitdaten dürfen schon gelöscht werden (vom Träger unter Mehr → Löschfristen). Beurteilungen dürfen ab 01.01.2030 gelöscht werden, ausgezahlte Überstunden ab 01.01.2037; danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2031-06-01')).toBe(
      'Persönliche Daten, Zeitdaten und Beurteilungen dürfen schon gelöscht werden (vom Träger unter Mehr → Löschfristen). Ausgezahlte Überstunden dürfen ab 01.01.2037 gelöscht werden; danach der Eintrag.',
    )
  })

  it('leaves out the paid overtime when nothing was paid out (the entry goes after the assessments)', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2026-10-27', false)).toBe(
      `${PERSONAL} Zeitdaten dürfen ab 01.01.2029 gelöscht werden, Beurteilungen ab 01.01.2030; danach der Eintrag.`,
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2029-06-01', false)).toBe(
      'Persönliche Daten und Zeitdaten dürfen schon gelöscht werden (vom Träger unter Mehr → Löschfristen). Beurteilungen dürfen ab 01.01.2030 gelöscht werden; danach der Eintrag.',
    )
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2030-01-01', false)).toBe(ALL_DONE)
  })

  it('tells who deletes when every period has run out, and that the entry goes last', () => {
    expect(archiveRetentionText('2026-03-15', RETENTION_DEFAULTS, '2037-01-01')).toBe(ALL_DONE)
  })
})
