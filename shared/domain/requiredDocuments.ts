import type { EmployeeDocumentFolder } from './personnel'
import { addMonths } from './requirements'
import { QUALIFICATIONS, type Qualification } from './staffing/types'
import type { IsoDate } from './types'

/**
 * Pflichtdokumente (docs/BETRIEB.md): the documents every employee of a facility – or those of chosen qualifications –
 * must have in the personnel file, each filed in a folder of it (whose key decides who sees and files it), optionally
 * valid for some months. A document of the file is linked to its type; the newest linked one decides the status.
 */

/** Who a type applies to: everyone, or the employees of the chosen qualifications. */
export type RequiredAppliesTo = 'all' | Qualification[]

/** The folder a Pflichtdokument goes into unless chosen otherwise (the Arbeitsvertrag stays in „contract“). */
export const REQUIRED_DOCUMENT_FOLDER: EmployeeDocumentFolder = 'required'

/**
 * The examples every facility starts with (active, changeable and deletable): all in the folder „Pflichtdokumente“
 * except the Arbeitsvertrag, which stays in „Vertrag“ with its rights (since 2026-11-26; the migration
 * *_required_documents_folder moved the existing ones).
 */
export const REQUIRED_DOCUMENT_EXAMPLES: readonly { name: string; folder: EmployeeDocumentFolder; validityMonths: number | null }[] = [
  { name: 'Arbeitsvertrag', folder: 'contract', validityMonths: null },
  { name: 'Erweitertes Führungszeugnis', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: 60 },
  { name: 'Masernnachweis', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null },
  { name: 'Belehrung Infektionsschutz', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null },
  { name: 'Verpflichtung auf den Datenschutz', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null },
  { name: 'Erste-Hilfe-Nachweis', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: 24 },
  { name: 'Schweigepflichterklärung', folder: REQUIRED_DOCUMENT_FOLDER, validityMonths: null },
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

export type RequiredDocumentState = 'missing' | 'present' | 'expiring' | 'expired'

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

/** Whether the status needs attention (the list column and „Was noch fehlt“): missing or expired. */
export const needsDocument = (state: RequiredDocumentState): boolean => state === 'missing' || state === 'expired'
