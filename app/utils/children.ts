import type { ChildContactDto, SectionStamp } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

/** `tel:` link target (digits and plus only, so spaces and slashes do not matter); undefined for text without a digit. */
export function telHref(phone: string): string | undefined {
  const number = phone.replace(/[^\d+]/g, '')
  return /\d/.test(number) ? `tel:${number}` : undefined
}

/** The phone numbers of a contact that are filled in, with their label. */
export function phonesOf(contact: ChildContactDto): { label: string; number: string }[] {
  return [
    { label: de.children.fields.phoneMobile, number: contact.phoneMobile },
    { label: de.children.fields.phoneHome, number: contact.phoneHome },
    { label: de.children.fields.phoneWork, number: contact.phoneWork },
  ].filter(phone => phone.number !== '')
}

/** "zuletzt geändert von … am …", or null while the section is untouched. */
export function stampText(stamp: SectionStamp): string | null {
  if (!stamp.updatedAt) return null
  return de.children.lastChanged(stamp.updatedBy ?? de.children.unknownUser, formatDateTime(stamp.updatedAt))
}

/** An empty date field means "no date". */
export const orNull = (value: string): string | null => (value === '' ? null : value)

/** The upload limit of a document (the server enforces the same). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

/** Where the file of a document is served; `download` asks for an attachment instead of showing it. */
export const documentFileUrl = (id: number, download = false): string => `/api/child-documents/${id}/file${download ? '?download=1' : ''}`

/** "812 KB", "2,4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
}
