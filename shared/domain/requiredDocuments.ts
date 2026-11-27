import { addDays, isValidIsoDate } from './dates'
import type { EmployeeDocumentFolder } from './personnel'
import { addMonths } from './requirements'
import { QUALIFICATIONS, type Qualification } from './staffing/types'
import type { IsoDate } from './types'

/**
 * Pflichtdokumente (docs/BETRIEB.md): the documents every employee of a facility – or those of chosen qualifications –
 * must have in the personnel file, each filed in a folder of it (whose key decides who sees and files it), optionally
 * valid for some months. A document of the file is linked to its type; the newest linked one decides the status.
 * A type „nur Einsicht vermerken“ (mode 'inspection', the Erweitertes Führungszeugnis, § 72a Abs. 5 SGB VIII) keeps no
 * file: per person the certificate's date and whether there is no relevant conviction decide the status (the day of
 * inspection is optional). A file once
 * kept for such a type carries a marker (employee_documents.inspection_cleanup) and stays on the cleanup list until it
 * is deleted, wherever it is moved or whatever it is linked to.
 */

/** What happened to an inspection record (the audit lines: who and when, nothing of the content). */
export const INSPECTION_LOG_ACTIONS = ['recorded', 'changed', 'deleted'] as const
export type InspectionLogAction = typeof INSPECTION_LOG_ACTIONS[number]

/** How a type is fulfilled: a document of the personnel file, or only a recorded inspection (no file). */
export const REQUIRED_DOCUMENT_MODES = ['file', 'inspection'] as const
export type RequiredDocumentMode = typeof REQUIRED_DOCUMENT_MODES[number]

/** Who a type applies to: everyone, or the employees of the chosen qualifications. */
export type RequiredAppliesTo = 'all' | Qualification[]

/** The folder a Pflichtdokument goes into unless chosen otherwise (the Arbeitsvertrag stays in „contract“). */
export const REQUIRED_DOCUMENT_FOLDER: EmployeeDocumentFolder = 'required'

/**
 * The examples every facility starts with (active, changeable and deletable): all in the folder „Pflichtdokumente“
 * except the Arbeitsvertrag, which stays in „Vertrag“ with its rights (since 2026-11-26; the migration
 * *_required_documents_folder moved the existing ones).
 */
export const REQUIRED_DOCUMENT_EXAMPLES: readonly {
  name: string; folder: EmployeeDocumentFolder; validityMonths: number | null; mode: RequiredDocumentMode
}[] = [
  { name: 'Arbeitsvertrag', folder: 'contract', validityMonths: null, mode: 'file' },
  // § 72a Abs. 5 SGB VIII: only the inspection is recorded, no copy kept (since 2026-11-26).
  { name: 'Erweitertes Führungszeugnis', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: 60, mode: 'inspection' },
  { name: 'Masernnachweis', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null, mode: 'file' },
  { name: 'Belehrung Infektionsschutz', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null, mode: 'file' },
  { name: 'Verpflichtung auf den Datenschutz', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null, mode: 'file' },
  { name: 'Erste-Hilfe-Nachweis', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: 24, mode: 'file' },
  { name: 'Schweigepflichterklärung', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null, mode: 'file' },
]

/**
 * The folder preset for a new type in the settings form: „Pflichtdokumente“ if the editor may use it, else the first
 * folder they may use (null: none – then there is nothing to add).
 */
export function defaultRequiredFolder(usable: readonly EmployeeDocumentFolder[]): EmployeeDocumentFolder | null {
  return usable.includes(REQUIRED_DOCUMENT_FOLDER) ? REQUIRED_DOCUMENT_FOLDER : usable[0] ?? null
}

/** Limits of a type as entered. */
export const REQUIRED_DOCUMENT_LIMITS = { name: 100, validityMonths: 240 } as const

/** A document expiring within this many months counts as „läuft ab“. */
export const EXPIRING_MONTHS = 2

/** The stored applies-to: 'all' or a JSON list of qualifications; anything unreadable counts as everyone. */
export function parseAppliesTo(text: string): RequiredAppliesTo {
  if (text === 'all') return 'all'
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return 'all'
    const known = parsed.filter((key): key is Qualification => (QUALIFICATIONS as readonly unknown[]).includes(key))
    return known.length === 0 ? 'all' : known
  }
  catch {
    return 'all'
  }
}

/** The applies-to as stored: 'all', or the qualifications once each in the catalog's order. */
export function serializeAppliesTo(value: RequiredAppliesTo): string {
  if (value === 'all') return 'all'
  const chosen = QUALIFICATIONS.filter(key => value.includes(key))
  return chosen.length === 0 ? 'all' : JSON.stringify(chosen)
}

/** Whether a type applies to an employee of the qualification (none entered: only the types for everyone). */
export const appliesToEmployee = (appliesTo: RequiredAppliesTo, qualification: Qualification | null): boolean =>
  appliesTo === 'all' || (qualification !== null && appliesTo.includes(qualification))

/** 'entry': an inspection recorded without „keine einschlägige Eintragung“ – to be checked by Leitung/Träger. */
export type RequiredDocumentState = 'missing' | 'present' | 'expiring' | 'expired' | 'entry'

/**
 * The status of a type for an employee from the date of the newest linked document: missing without one; with a
 * validity, expired from the end of validity on and „läuft ab“ in the 2 months before it; present otherwise.
 */
export function requiredDocumentStatus(
  validityMonths: number | null, newest: IsoDate | null, today: IsoDate,
): { state: RequiredDocumentState; date: IsoDate | null; expiresOn: IsoDate | null } {
  if (newest === null) return { state: 'missing', date: null, expiresOn: null }
  if (validityMonths === null) return { state: 'present', date: newest, expiresOn: null }
  const expiresOn = addMonths(newest, validityMonths)
  const state = today >= expiresOn ? 'expired' : today >= addMonths(expiresOn, -EXPIRING_MONTHS) ? 'expiring' : 'present'
  return { state, date: newest, expiresOn }
}

/**
 * The status of a type „nur Einsicht vermerken“ from the person's recorded inspection: missing without one; with a
 * relevant entry (the box not ticked) 'entry', whatever the date; otherwise as a document dated on the certificate's
 * date (the validity runs from it, as the certificate's age counts – not the day it was shown).
 */
export function inspectionStatus(
  validityMonths: number | null, inspection: { certificateDate: IsoDate; noRelevantEntry: boolean } | null, today: IsoDate,
): { state: RequiredDocumentState; date: IsoDate | null; expiresOn: IsoDate | null } {
  if (inspection === null) return { state: 'missing', date: null, expiresOn: null }
  if (!inspection.noRelevantEntry) return { state: 'entry', date: inspection.certificateDate, expiresOn: null }
  return requiredDocumentStatus(validityMonths, inspection.certificateDate, today)
}

/**
 * The dates of an inspection as entered: „Datum des Führungszeugnisses“ a real date, not after today; „eingesehen am“
 * optional (null), the same, and not before the certificate's date. null when fine, else the error code.
 */
export function inspectionDateError(
  certificateDate: string, inspectedOn: string | null, today: IsoDate,
): 'certificate_date_invalid' | 'certificate_date_future' | 'inspection_date_invalid' | 'inspection_date_future' | 'inspection_before_certificate' | null {
  if (!isValidIsoDate(certificateDate)) return 'certificate_date_invalid'
  if (certificateDate > today) return 'certificate_date_future'
  if (inspectedOn === null) return null
  if (!isValidIsoDate(inspectedOn)) return 'inspection_date_invalid'
  if (inspectedOn > today) return 'inspection_date_future'
  return inspectedOn < certificateDate ? 'inspection_before_certificate' : null
}

/**
 * The deadline of the inspection record of someone who left (§ 72a Abs. 5 SGB VIII: „unverzüglich zu löschen, wenn …
 * keine Tätigkeit wahrgenommen wird“, otherwise „spätestens drei Monate nach der Beendigung“): deletable from the day
 * after leaving, to be gone by `deleteBy` (the leaving day + 3 months, the last day allowed). Not taken up – the
 * leaving day before the start – `deleteBy` is null: at once, so it is overdue as soon as it is listed.
 */
export function inspectionDeadline(leftOn: IsoDate, startedOn: IsoDate | null): { deletableFrom: IsoDate; deleteBy: IsoDate | null } {
  return { deletableFrom: addDays(leftOn, 1), deleteBy: startedOn !== null && leftOn < startedOn ? null : addMonths(leftOn, 3) }
}

/** Whether the deadline has passed today (at once: whenever the record is listed at all). */
export const inspectionOverdue = (deleteBy: IsoDate | null, today: IsoDate): boolean => deleteBy === null || today > deleteBy

/**
 * Whether a type is the Erweitertes Führungszeugnis (any type whose name holds „Führungszeugnis“, compared as the app
 * compares names): only then do the texts name § 72a SGB VIII and „einschlägige Eintragung“; any other type „nur Einsicht
 * vermerken“ gets neutral texts („in Ordnung“ / „Beanstandung“).
 */
export const isCertificateType = (name: string): boolean => name.trim().toLocaleLowerCase('de').includes('führungszeugnis')

/** Whether the status needs attention (the list column and „Was noch fehlt“): missing, expired or an entry to check. */
export const needsDocument = (state: RequiredDocumentState): boolean => state === 'missing' || state === 'expired' || state === 'entry'
