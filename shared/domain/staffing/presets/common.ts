import type { IsoDate } from '../../types'
import type { AddOn, Qualification } from '../types'

/**
 * Default counting shares in percent. Without a value from the research: Fachkraft and
 * Ergänzungskraft 100, trainees/students/interns 0 (never overstate the planned staff), Haushaltskraft 0, `none` 0.
 */
export function shares(over: Partial<Record<Qualification, number>> = {}): Record<Qualification, number> {
  return {
    fachkraft: 100, ergaenzung: 100, azubi_1: 0, azubi_2: 0, azubi_3: 0, azubi_spa_1: 0, azubi_spa_2: 0, azubi_spa_3: 0,
    studium_1: 0, studium_2: 0, studium_3: 0, praktikant: 0, haushalt: 0, none: 0, ...over,
  }
}

/**
 * Start of the preset versions with the re-researched counting of trainees, students and Berufspraktikanten
 * (research of 19.11.2026, no change of the laws; from November 2026 on): the earlier versions keep their values,
 * Träger overrides keep applying across them (`correction`).
 */
export const TRAINEES_REVISED: IsoDate = '2026-11-01'

/** Opening of the note of those versions. */
export const TRAINEES_NOTE = 'Ab 01.11.2026 mit neu recherchierter Anrechnung von Auszubildenden, Studierenden und '
  + 'Berufspraktikanten (keine Gesetzesänderung). Auszubildende = angestellte Erzieher-Auszubildende (PiA/'
  + 'berufsbegleitend), Studium = duales/praxisintegriertes Studium (Kindheitspädagogik, Soziale Arbeit); andere '
  + 'Fälle bitte beim Mitarbeiter unter „Anrechnung in %“ eintragen.'

/** Leitung add-on: once per facility, shown only (not checked against the plan in this step). */
export function leitung(addOn: Omit<AddOn, 'key' | 'label' | 'scope' | 'counts'>): AddOn {
  return { key: 'leitung', label: 'Leitungszeit', scope: 'facility', counts: false, ...addOn }
}
