import type { ChildContactDto, SectionStamp } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

/** `tel:` link target: only digits and a leading plus survive, so spaces and slashes in the stored text do not matter. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
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
