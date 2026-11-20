import { contactMatches } from '#shared/domain/contacts'
import type { ContactCategoryDto, ContactDto } from '#shared/types/api'

/** The sub-tab of „Kontakte“: all contacts, one category (its id), or „Vom Träger“. */
export type ContactTabKey = 'all' | 'provider' | `${number}`

export interface ContactTab {
  key: ContactTabKey
  /** The category; null for „Alle“ and „Vom Träger“. */
  category: ContactCategoryDto | null
  count: number
}

/**
 * The sub-tabs: „Alle“, then the facility's categories in their order (whoever maintains the contacts sees every one,
 * to file into it; everyone else only those holding contacts they see) and „Vom Träger“ last, while contacts for all
 * facilities show there.
 */
export function contactTabs(categories: readonly ContactCategoryDto[], contacts: readonly ContactDto[], manage: boolean): ContactTab[] {
  const fromProvider = contacts.filter(contact => contact.categoryId === null).length
  return [
    { key: 'all', category: null, count: contacts.length },
    ...categories.filter(category => manage || category.contactCount > 0)
      .map(category => ({ key: `${category.id}` as const, category, count: category.contactCount })),
    ...(fromProvider > 0 ? [{ key: 'provider' as const, category: null, count: fromProvider }] : []),
  ]
}

/** The tab key from the address (?kategorie=), 'all' for anything unknown. */
export function contactTabFromQuery(value: unknown, tabs: readonly ContactTab[]): ContactTabKey {
  const key = typeof value === 'string' ? value : ''
  return tabs.find(tab => tab.key === key)?.key ?? 'all'
}

/** The contacts of the tab that match the search (organisation, person, role, note, city), in the server's order. */
export function contactsOfTab(contacts: readonly ContactDto[], tab: ContactTabKey, query = ''): ContactDto[] {
  return contacts.filter(contact => (tab === 'all' || (tab === 'provider' ? contact.categoryId === null : `${contact.categoryId}` === tab))
    && contactMatches(contact, query))
}

/** The address in one line: „Hauptstraße 1, 69117 Heidelberg“ ('' without any part). */
export function contactAddress(contact: Pick<ContactDto, 'street' | 'postalCode' | 'city'>): string {
  const place = [contact.postalCode, contact.city].filter(Boolean).join(' ')
  return [contact.street, place].filter(Boolean).join(', ')
}

/** The printout of the tab: /print/contacts/all, /print/contacts/<category id> or /print/contacts/provider. */
export const contactPrintPath = (tab: ContactTabKey) => `/print/contacts/${tab}`

/** The website without its scheme, for showing („www.schule.de“). */
export const websiteLabel = (website: string) => website.replace(/^https?:\/\//i, '').replace(/\/$/, '')

/** The name of the tab's category for headings („Vom Träger“ and „Alle“ come from the caller). */
export function tabCategoryName(tabs: readonly ContactTab[], key: ContactTabKey): string | null {
  return tabs.find(tab => tab.key === key)?.category?.name ?? null
}

/**
 * The list of school children grouped by their future school (alphabetical, „ohne“ last); the children keep their order
 * inside a school.
 */
export function groupBySchool<T extends { futureSchool: string | null }>(rows: readonly T[]): { school: string | null; rows: T[] }[] {
  const groups = new Map<string | null, T[]>()
  for (const row of rows) {
    const list = groups.get(row.futureSchool) ?? []
    list.push(row)
    groups.set(row.futureSchool, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'de')))
    .map(([school, list]) => ({ school, rows: list }))
}
