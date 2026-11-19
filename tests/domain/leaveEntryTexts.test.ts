import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { leaveEntryToast, leaveRemovalQuestion } from '../../app/utils/leaveEntry'

const format = (date: string) => date.split('-').reverse().join('.')

describe('texts of „Urlaub eintragen“ and „Entfernen“', () => {
  it('names the plan days written, singular and plural', () => {
    expect(leaveEntryToast({ booked: 1, keptAbsences: 0 }, 'Urlaub')).toEqual({ title: 'Urlaub an 1 Tag eingetragen.', color: 'success' })
    expect(leaveEntryToast({ booked: 5, keptAbsences: 0 }, 'Überstundenfrei').title).toBe('Überstundenfrei an 5 Tagen eingetragen.')
  })

  it('names kept absences neutrally, other leave included, with singular verbs for one day', () => {
    expect(leaveEntryToast({ booked: 2, keptAbsences: 1 }, 'Sonderurlaub').title).toBe(
      'Sonderurlaub an 2 Tagen eingetragen. 1 Tag mit einer anderen Abwesenheit (Krank, Fortbildung, Urlaub o. Ä.) blieb unverändert und zählt nicht als Sonderurlaub.',
    )
    expect(de.leavePlanning.approvedKept(2)).toBe(
      'Genehmigt. 2 Tage mit einer anderen Abwesenheit (Krank, Fortbildung, Urlaub o. Ä.) blieben unverändert und zählen nicht als Urlaub.',
    )
  })

  it('is neutral when nothing was written', () => {
    expect(leaveEntryToast({ booked: 0, keptAbsences: 0 }, 'Urlaub')).toEqual({ title: 'Der Zeitraum ist schon eingetragen.', color: 'neutral' })
    expect(leaveEntryToast({ booked: 0, keptAbsences: 3 }, 'Sonderurlaub')).toMatchObject({ color: 'neutral' })
    expect(leaveEntryToast({ booked: 0, keptAbsences: 3 }, 'Sonderurlaub').title).toMatch(/^Nichts eingetragen\. 3 Tage mit einer anderen Abwesenheit/)
  })

  it('asks about „Einträge“ when ÜF or another entry would be replaced, else about „Dienste“', () => {
    expect(de.leavePlanning.overwriteConfirm(2, 'Urlaub')).toBe(
      'An 2 Tagen sind schon Dienste eingetragen. Durch „Urlaub“ ersetzen? (Krank, Fortbildung u. Ä. bleiben immer erhalten.)',
    )
    expect(de.leavePlanning.overwriteConfirm(1, 'Urlaub', true)).toBe(
      'An 1 Tag sind schon Einträge eingetragen. Durch „Urlaub“ ersetzen? (Krank, Fortbildung u. Ä. bleiben immer erhalten.)',
    )
  })

  it('warns about minus hours only when the period has past days', () => {
    expect(leaveRemovalQuestion('Urlaub', '2026-12-01', '2026-12-04', '2026-11-19', format))
      .toBe('Urlaub vom 01.12.2026 bis 04.12.2026 entfernen? Die Tage sind danach wieder frei.')
    expect(leaveRemovalQuestion('Urlaub', '2026-11-16', '2026-11-20', '2026-11-19', format))
      .toBe('Urlaub vom 16.11.2026 bis 20.11.2026 entfernen? Ohne andere Einträge zählen vergangene Tage danach als Minusstunden.')
    expect(de.leaveEntry.removedKeptClosure(2, 1)).toBe('2 Tage entfernt. 1 Tag aus Schließzeiten bleibt eingetragen.')
  })
})
