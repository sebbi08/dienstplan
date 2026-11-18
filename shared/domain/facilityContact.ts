/**
 * Contact data of a facility (Kontakt): address, website, Träger and Leitung as free text, and phone numbers and e-mail
 * addresses, each belonging to the facility itself, its Leitung or its Träger. Pure checks, shared by the server and the
 * settings page.
 */

export const CONTACT_KINDS = ['phone', 'email'] as const
export type FacilityContactKind = typeof CONTACT_KINDS[number]

export const CONTACT_OWNERS = ['facility', 'leitung', 'traeger'] as const
export type FacilityContactOwner = typeof CONTACT_OWNERS[number]

export interface FacilityContactEntry {
  kind: FacilityContactKind
  value: string
  /** Whose number or address it is. */
  belongsTo: FacilityContactOwner
  /** Optional, e.g. „Büro“ or „Handy“ ('' = none). */
  label: string
}

/** What the Träger edits and the Leitung reads; every text is '' when not set. */
export interface FacilityContactDto {
  street: string
  /** Five digits or ''. */
  postalCode: string
  city: string
  /** As typed (with or without https://), trimmed. */
  website: string
  /** The operator's name (Träger), free text. */
  operator: string
  /** Name(s) of the Leitung, free text. */
  manager: string
  /** In the order the Träger arranged them. */
  contacts: FacilityContactEntry[]
}

export const MAX_CONTACT_ENTRIES = 30
export const MAX_CONTACT_TEXT = 120

export const isPostalCode = (value: string): boolean => /^\d{5}$/.test(value)

/** Plausible, not exhaustive: something@domain.tld without blanks. */
export const isEmailAddress = (value: string): boolean => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)

/** Digits, blanks and + / - ( ) only, with at least three digits. */
export function isPhoneNumber(value: string): boolean {
  return /^[\d\s+/()-]+$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 3
}

/** A host name with a dot, optionally with https:// or http:// in front and a path behind; no blanks. */
export const isWebsite = (value: string): boolean => /^(https?:\/\/)?[^\s/:]+\.[^\s/:]+(:\d+)?(\/\S*)?$/i.test(value)

/** The link target of a stored website: https:// is added when no scheme was typed ('' stays ''). */
export function websiteHref(website: string): string {
  const trimmed = website.trim()
  if (trimmed === '') return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** The `tel:` link of a phone number: only digits and a leading + are kept; „(0)“ after a country code is dropped. */
export function telHref(value: string): string {
  const plus = value.trim().startsWith('+') ? '+' : ''
  const number = plus ? value.replace(/\(0\)/g, '') : value
  return `tel:${plus}${number.replace(/\D/g, '')}`
}

/** The facility's address on one line: „Straße, PLZ Ort“ (parts that are not set are left out). */
export function addressLine(street: string, postalCode: string, city: string): string {
  const place = [postalCode, city].filter(part => part !== '').join(' ')
  return [street, place].filter(part => part !== '').join(', ')
}
