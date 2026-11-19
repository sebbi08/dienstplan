import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { ifsgDayText, ifsgEarliestText } from '../../app/utils/ifsg'

describe('the § 34 IfSG texts', () => {
  it('names the earliest readmission with weekday and the rule\'s condition', () => {
    // 2026-11-25 is a Wednesday.
    expect(ifsgDayText('2026-11-25')).toBe('Mi 25.11.')
    expect(ifsgEarliestText('2026-11-25')).toBe('frühestens ab Mi 25.11.')
    expect(ifsgEarliestText('2026-11-25', 'und symptomfrei')).toBe('frühestens ab Mi 25.11. und symptomfrei')
    expect(ifsgEarliestText(null, 'und symptomfrei')).toBe(de.ifsg.noEarliest)
  })

  it('words the reminder and the notice as asked, the notice without any name', () => {
    const reminder = de.reminders.ifsg('Windpocken (Varizellen)', 'Bären')
    expect(`${reminder.before}Lena Meier${reminder.after}`)
      .toBe('Gesundheitsamt unverzüglich benachrichtigen (§ 34 Abs. 6 IfSG): Windpocken (Varizellen) – Lena Meier, Bären')
    expect(de.ifsg.notice.text('Bären', 'Scharlach')).toBe('In der Gruppe Bären ist Scharlach aufgetreten.')
    expect(de.ifsg.readmit.early('Mi 25.11.', 'Laut RKI')).toBe('Laut RKI frühestens ab Mi 25.11. Trotzdem wieder zulassen?')
    expect(de.ifsg.readmit.early('Mi 25.11.', de.ifsg.readmit.earlySourceLocal('Rhein-Neckar-Kreis')))
      .toBe('Laut Gesundheitsamt Rhein-Neckar-Kreis frühestens ab Mi 25.11. Trotzdem wieder zulassen?')
    expect(de.ifsg.readmit.early('morgen', 'Laut RKI')).toBe('Laut RKI frühestens ab morgen. Trotzdem wieder zulassen?')
    expect(de.ifsg.blockWarning).toBe('Betretungsverbot nach § 34 IfSG – Wiederzulassung nur nach ärztlichem Urteil')
    expect(de.ifsg.footer).toBe('Grundlage: RKI-Empfehlungen zur Wiederzulassung gemäß § 34 IfSG, Stand 23.10.2026. Ersetzt nicht die Bewertung im Einzelfall durch das Gesundheitsamt.')
  })
})
