import { todayIso } from './dates'
import type { IsoDate } from './types'

/**
 * „Zum Unterschreiben senden“ (server/services/signRequests.ts): the Leitung sends a PDF to employees, who sign it in the
 * app with a drawn signature; the signed copy goes into their personnel file. The rules both sides share.
 */

export const SIGN_REQUEST_STATUSES = ['open', 'signed', 'declined', 'withdrawn'] as const
export type SignRequestStatus = typeof SIGN_REQUEST_STATUSES[number]

/** At most this long: the reason for not signing. */
export const DECLINE_REASON_MAX = 300
/** At most this long: the title of a request (the signed copy's title adds „ – unterschrieben am …“ within 200). */
export const SIGN_REQUEST_TITLE_MAX = 160
/** At most this long: the sender's note to the recipients. */
export const SIGN_REQUEST_NOTE_MAX = 1000
/** At most this many recipients per request. */
export const SIGN_REQUEST_MAX_RECIPIENTS = 200
/**
 * A finished request (with its PDF) may be deleted by the Träger under Löschfristen one year after its last recipient
 * finished (signed, declined, withdrawn); the app deletes nothing by itself.
 */
export const SIGN_REQUEST_RETENTION_YEARS = 1

/** The sign-only unlock of the tablet ends after this long without use … */
export const SIGN_UNLOCK_IDLE_MS = 3 * 60 * 1000
/** … and at the latest this long after the PIN, whatever the facility's windows without the automatic lock. */
export const SIGN_UNLOCK_MAX_MS = 10 * 60 * 1000

/** Whether a sign-only unlock (created and last used at these ISO moments) still holds at `now`. */
export function signUnlockValid(createdAt: string, lastActiveAt: string, now: Date): boolean {
  const at = now.getTime()
  return at - Date.parse(lastActiveAt) <= SIGN_UNLOCK_IDLE_MS && at - Date.parse(createdAt) <= SIGN_UNLOCK_MAX_MS
}

const fold = (text: string) => text.toLocaleLowerCase('de').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')

/**
 * Titles of documents the law wants in written form (a wet signature on paper), which a drawn signature in the app does
 * not satisfy: dismissal (§ 623 BGB), a fixed term (§ 14 Abs. 4 TzBfG), an employment reference (§ 109 Abs. 3 GewO), a
 * termination agreement (§ 623 BGB) – and the employment contract, whose fixed-term clause or terms often need it. Not
 * the Führungszeugnis or Gesundheitszeugnis, which a Kita often has signed for receipt.
 */
const WRITTEN_FORM_WORDS = [
  'kuendigung', 'befrist', 'arbeitsvertrag', 'arbeitszeugnis', 'zwischenzeugnis', 'endzeugnis', 'dienstzeugnis',
  'aufhebungsvertrag', 'aufhebungsvereinbarung',
]

/** Whether the title suggests a document that needs the written form (the dialog then warns, it does not block). */
export function writtenFormHint(title: string): boolean {
  const text = fold(title)
  return WRITTEN_FORM_WORDS.some(word => text.includes(word))
}

const berlinDateTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const berlinDay = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })

/** „Belehrung – unterschrieben am 24.11.2026“ (the title shortened so the whole fits the document title's 200 characters). */
export function signedDocumentTitle(title: string, signedAt: Date): string {
  const suffix = ` – unterschrieben am ${berlinDay.format(signedAt)}`
  return `${title.trim().slice(0, 200 - suffix.length)}${suffix}`
}

/** The line written onto the last page of the signed copy: „Elektronisch unterschrieben von Anna Probe am 24.11.2026 09:15“. */
export function signatureFooter(name: string, signedAt: Date): string {
  return `Elektronisch unterschrieben von ${name.trim()} am ${berlinDateTime.format(signedAt).replace(', ', ' ')}`
}

/** Whether an open request is past its due date (the day after the due date). */
export function isOverdue(dueDate: IsoDate | null, today: IsoDate, status: SignRequestStatus = 'open'): boolean {
  return status === 'open' && dueDate !== null && dueDate < today
}

/** The moment the recipient finished (signed, declined or withdrawn); null while open. */
export function finishedAt(recipient: { status: SignRequestStatus; signedAt: string | null; declinedAt: string | null; withdrawnAt: string | null }): string | null {
  if (recipient.status === 'signed') return recipient.signedAt
  if (recipient.status === 'declined') return recipient.declinedAt
  if (recipient.status === 'withdrawn') return recipient.withdrawnAt
  return null
}

/**
 * From when the Träger may delete a finished request with its PDF under Löschfristen: the Berlin day one year after the
 * last recipient finished; null while one is still open. A request without recipients (all deleted with their
 * employees) counts from when it was sent.
 */
export function signRequestDeletableFrom(
  createdAt: string, recipients: readonly Parameters<typeof finishedAt>[0][],
): IsoDate | null {
  const ends = recipients.map(finishedAt)
  if (ends.some(end => end === null)) return null
  const last = ends.reduce<string>((latest, end) => (end! > latest ? end! : latest), createdAt)
  const day = todayIso(new Date(last))
  return `${Number(day.slice(0, 4)) + SIGN_REQUEST_RETENTION_YEARS}${day.slice(4)}`.replace(/-02-29$/, '-03-01')
}

/** The recipients of a form field („3,5,8“): distinct positive ids, in their order; null when one is not a number. */
export function parseRecipientIds(text: string): number[] | null {
  const parts = text.split(',').map(part => part.trim()).filter(part => part !== '')
  if (parts.some(part => !/^\d+$/.test(part))) return null
  const ids = [...new Set(parts.map(Number))]
  return ids.length > 0 && ids.every(id => id > 0) ? ids : null
}
