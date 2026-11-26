import type { Role } from '../types/api'
import { TEMPLATE_VISIBILITIES, stricterVisibility, type TemplateVisibility } from './templateCategories'

/**
 * The facility's address book („Kontakte“): external business contacts such as schools, the Jugendamt or the
 * Fachberatung, filed in categories of the facility's own (like the print template categories).
 *
 * Who sees a contact follows the same model as „Vorlagen“ and „Wissen“: each category says „Wer sieht sie?“ (all /
 * Leitung and Träger / Träger only), and each contact has the same three levels on top („Wer sieht ihn?“); the stricter
 * of both counts, and under „Vom Träger“ (no category of that name) the contact's own alone. „Leitung und Träger“ means
 * whoever maintains the address book (contacts.manage); „nur Träger“ only such a person with the role Träger.
 */

/**
 * The categories every facility starts with, in this order, as copies of its own to rename, reorder or delete. Existing
 * facilities got them from the migration 0109_contacts, new ones get them from createFacility.
 */
export const DEFAULT_CONTACT_CATEGORIES = [
  'Schulen', 'Jugendamt', 'Gesundheitsamt', 'Fachberatung', 'Ärztinnen/Ärzte & Therapie', 'Träger & Verwaltung',
  'Handwerk & Notdienst', 'Sonstiges',
] as const

/** Names that differ only in case (umlauts included), surrounding spaces or ß/ss count as the same. */
export const comparableContactName = (name: string) => name.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss')

/** A category of schools: its name contains „Schule“ (Schulen, Grundschulen, Schule & Hort …), regardless of case. */
export const isSchoolCategory = (name: string) => comparableContactName(name).includes('schule')

/** The longest texts of a contact (the form and the server use the same). */
export const CONTACT_LIMITS = {
  organisation: 120, person: 120, role: 120, phone: 40, mobile: 40, email: 200, street: 200, postalCode: 10, city: 100,
  website: 300, note: 1000, categoryName: 60,
} as const

/**
 * Whether the text is an e-mail address: something@domain.tld without spaces. Deliberately loose, it only catches
 * typing mistakes; empty is no address (the field is optional, the caller decides). Characters that would add to the
 * mailto: link (a query such as ?bcc=, further recipients, quoting, %-escapes) are refused.
 */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@?&,;<>"()%]+@[^\s@?&,;<>"()%]+\.[^\s@?&,;<>"()%]+$/.test(value)
}

/**
 * The website as it is stored and linked: http or https only; without a scheme „https://“ is put in front
 * („www.schule.de“, also with a port: „schule.de:8080“). Null for anything else (another scheme such as javascript:,
 * no host, spaces). Empty stays empty.
 */
export function normalizedWebsite(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (/\s/.test(trimmed)) return null
  // A scheme is a word with a colon that no digit follows (that would be a host with its port).
  const withScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return withScheme
  }
  catch {
    return null
  }
}

/** The fields the search looks into: organisation, person, role, note and city. */
export interface SearchableContact {
  organisation: string
  person: string
  role: string
  note: string
  city: string
}

/** Whether the contact matches every word of the search (regardless of case; an empty search matches all). */
export function contactMatches(contact: SearchableContact, query: string): boolean {
  const words = comparableContactName(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = comparableContactName([contact.organisation, contact.person, contact.role, contact.note, contact.city].join(' '))
  return words.every(word => text.includes(word))
}

/**
 * A phone number as a tel: link target: only digits and a leading +; the „(0)“ of „+49 (0)6221“ is dropped. Empty when
 * no digit is left (the number is then shown as plain text).
 */
export function telHref(phone: string): string {
  const trimmed = phone.trim()
  const international = trimmed.startsWith('+')
  const digits = (international ? trimmed.replace(/\(0\)/g, '') : trimmed).replace(/\D/g, '')
  return digits === '' ? '' : `tel:${international ? '+' : ''}${digits}`
}

// ---- who sees a contact ------------------------------------------------------

/** The widest visibility a viewer of the address book sees: the Träger everything, other maintainers all but the Träger's. */
export function contactViewLevel(role: Role, manages: boolean): TemplateVisibility {
  if (!manages) return 'all'
  return role === 'provider' ? 'provider' : 'managers'
}

/** The visibilities a viewer at that level sees (and may give a category), in catalog order. */
export const contactLevels = (level: TemplateVisibility): TemplateVisibility[] =>
  TEMPLATE_VISIBILITIES.slice(0, TEMPLATE_VISIBILITIES.indexOf(level) + 1)

/** Whether a viewer at that level sees something of that visibility. */
export const seesAtLevel = (level: TemplateVisibility, visibility: TemplateVisibility): boolean =>
  TEMPLATE_VISIBILITIES.indexOf(visibility) <= TEMPLATE_VISIBILITIES.indexOf(level)

/**
 * Who sees a contact where it shows: its category's visibility (none under „Vom Träger“) and its own „Wer sieht ihn?“,
 * the stricter one wins.
 */
export const contactVisibility = (category: TemplateVisibility | null, own: TemplateVisibility): TemplateVisibility =>
  stricterVisibility(category ?? 'all', own)

/**
 * Whether the Träger-only contacts count for the viewer (also as names among the „künftige Schule“ choices): only for
 * the Träger who maintains the address book.
 */
export const seesProviderContacts = (role: Role, manages: boolean): boolean => contactViewLevel(role, manages) === 'provider'
