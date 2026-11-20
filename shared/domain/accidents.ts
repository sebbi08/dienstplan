import { addDays } from './dates'
import type { FormContent, FormItem } from './forms'
import type { IsoDate } from './types'

/**
 * Accident reports („Unfälle“): Unfallberichte about children and Unfallanzeigen about employees, both forms of kind
 * `accident` (shared/domain/forms.ts) with a fixed header (Datum, Uhrzeit, Arztbesuch, arbeitsunfähig, gemeldet am).
 */

/** Days after the accident within which the Unfallkasse must have the report (§ 193 SGB VII: within 3 days). */
export const REPORT_DAYS = 3

/** At most this many attachments per accident report. */
export const MAX_ACCIDENT_ATTACHMENTS = 20

/** Whether a report to the Unfallkasse is due: a doctor was seen or the employee is unfit for work, not reported yet. */
export function reportDue(form: { doctor: boolean; unfit: boolean; reportedOn: IsoDate | null }): boolean {
  return (form.doctor || form.unfit) && form.reportedOn === null
}

/** The reminder's state: upcoming within the 3 days, today on the last one, overdue after it. */
export function reportState(accidentDate: IsoDate, today: IsoDate): 'upcoming' | 'today' | 'overdue' {
  const due = addDays(accidentDate, REPORT_DAYS)
  if (today > due) return 'overdue'
  return today === due ? 'today' : 'upcoming'
}

/**
 * Job titles and qualifications in words, for the prefill of field 24 „beschäftigt/tätig als“ (the server cannot read the
 * app's texts; these are the same words as app/locales/de.ts → contract.jobs and staffing.qualifications, except the
 * students: the form asks for an activity, so „Studierende/r …“ instead of „Studium …“).
 */
export const JOB_TITLES: Record<string, string> = {
  childcare_worker: 'Kinderpfleger/in', social_assistant: 'Sozialassistent/in', educator: 'Erzieher/in',
  educator_complex: 'Erzieher/in mit besonders schwierigen fachlichen Tätigkeiten', curative_educator: 'Heilerziehungspfleger/in',
  social_pedagogue: 'Sozialpädagoge/-pädagogin bzw. Kindheitspädagoge/-pädagogin', deputy_head: 'Ständige Vertretung der Leitung',
  head: 'Leitung',
}
export const QUALIFICATION_TITLES: Record<string, string> = {
  fachkraft: 'Fachkraft', ergaenzung: 'Ergänzungs-/Zusatzkraft', azubi_1: 'Auszubildende/r (1. Jahr)',
  azubi_2: 'Auszubildende/r (2. Jahr)', azubi_3: 'Auszubildende/r (3. Jahr)',
  azubi_spa_1: 'Auszubildende/r Sozialpädagogische Assistenz, praxisintegriert (1. Jahr)',
  azubi_spa_2: 'Auszubildende/r Sozialpädagogische Assistenz, praxisintegriert (2. Jahr)',
  azubi_spa_3: 'Auszubildende/r Sozialpädagogische Assistenz, praxisintegriert (3. Jahr)',
  studium_1: 'Studierende/r praxisintegriert/dual (1. Studienjahr)', studium_2: 'Studierende/r praxisintegriert/dual (2. Studienjahr)',
  studium_3: 'Studierende/r praxisintegriert/dual (ab 3. Studienjahr)', praktikant: 'Berufspraktikant/in (Anerkennungsjahr)',
  haushalt: 'Haushaltskraft',
}

/** The text an item shows as its label. */
export function itemLabel(item: FormItem): string {
  switch (item.kind) {
    case 'note': return item.text
    case 'rating': return item.criterion
    case 'milestone': return item.text
    default: return item.question
  }
}

/** The official field number an item's label starts with („17 Unfall im Homeoffice?“ → 17), or null. */
export function fieldNumber(item: FormItem): number | null {
  const match = /^(\d{1,2})\s/.exec(itemLabel(item).trim())
  if (!match) return null
  const number = Number(match[1])
  return number >= 1 && number <= 29 ? number : null
}

/**
 * The items of a U 1000 form by official field (1–29): an item whose label starts with the field's number opens it, the
 * items after it without a number of their own belong to it (e.g. „Die Angaben beruhen auf der Schilderung“ to 18).
 * Items before the first numbered one, or after a number that came already, land in `other`, so a changed copy still
 * prints everything.
 */
export function u1000Fields(content: FormContent): { fields: Map<number, FormItem[]>; other: FormItem[] } {
  const fields = new Map<number, FormItem[]>()
  const other: FormItem[] = []
  let current: FormItem[] = other
  for (const item of content.sections.flatMap(section => section.items)) {
    const number = fieldNumber(item)
    if (number !== null && !fields.has(number)) {
      current = [item]
      fields.set(number, current)
    }
    else if (number !== null) {
      current = other
      other.push(item)
    }
    else {
      current.push(item)
    }
  }
  return { fields, other }
}
