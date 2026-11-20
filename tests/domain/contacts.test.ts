import { describe, expect, it } from 'vitest'
import {
  contactAddress, contactPrintPath, contactsOfTab, contactTabFromQuery, contactTabs, groupBySchool, tabCategoryName, websiteLabel,
} from '../../app/utils/contacts'
import { contactMatches, isEmailAddress, isSchoolCategory, normalizedWebsite, telHref } from '../../shared/domain/contacts'
import type { ContactCategoryDto, ContactDto } from '../../shared/types/api'

const category = (id: number, name: string, contactCount = 0): ContactCategoryDto => ({ id, name, contactCount, ownCount: contactCount })
const contact = (id: number, categoryId: number | null, overrides: Partial<ContactDto> = {}): ContactDto => ({
  id, categoryId, global: categoryId === null, globalCategoryName: null, organisation: `Kontakt ${id}`, person: '', role: '',
  phone: '', mobile: '', email: '', street: '', postalCode: '', city: '', website: '', note: '', visibleToStaff: true,
  updatedAt: '2026-11-20T09:00:00.000Z', updatedBy: null, canEdit: false, ...overrides,
})

describe('contact fields', () => {
  it('checks e-mail addresses loosely', () => {
    expect(isEmailAddress('sekretariat@gs-sued.de')).toBe(true)
    expect(isEmailAddress('kein-at.de')).toBe(false)
    expect(isEmailAddress('a b@c.de')).toBe(false)
    expect(isEmailAddress('a@localhost')).toBe(false)
  })

  it('takes websites with http or https only, putting https:// in front of a bare host', () => {
    expect(normalizedWebsite('')).toBe('')
    expect(normalizedWebsite(' www.schule.de ')).toBe('https://www.schule.de')
    expect(normalizedWebsite('http://schule.de/kontakt')).toBe('http://schule.de/kontakt')
    expect(normalizedWebsite('HTTPS://Schule.de')).toBe('HTTPS://Schule.de')
    for (const bad of ['javascript:alert(1)', 'ftp://schule.de', 'data:text/html,x', 'schule', 'www.schule .de']) {
      expect(normalizedWebsite(bad), bad).toBeNull()
    }
  })

  it('makes tel: links of phone numbers', () => {
    expect(telHref('06221 / 12 34-5')).toBe('tel:0622112345')
    expect(telHref('+49 (0)6221 12345')).toBe('tel:+49622112345')
  })

  it('finds every word in organisation, person, role, note or city, regardless of case', () => {
    const entry = { organisation: 'Grundschule Süd', person: 'Frau Kern', role: 'Kooperationslehrkraft', note: 'dienstags', city: 'Heidelberg' }
    expect(contactMatches(entry, '')).toBe(true)
    expect(contactMatches(entry, 'süd kern')).toBe(true)
    expect(contactMatches(entry, 'HEIDELBERG koop')).toBe(true)
    expect(contactMatches(entry, 'Dienstags')).toBe(true)
    expect(contactMatches(entry, 'nord')).toBe(false)
  })

  it('knows the categories of schools by „Schule“ in their name', () => {
    expect(['Schulen', 'Grundschulen', 'Schule & Hort', 'SCHULEN'].every(isSchoolCategory)).toBe(true)
    expect(['Jugendamt', 'Hort', 'Schulamt'].map(isSchoolCategory)).toEqual([false, false, false])
  })
})

describe('the page „Kontakte“', () => {
  const categories = [category(1, 'Schulen', 2), category(2, 'Jugendamt', 0), category(3, 'Sonstiges', 1)]
  const contacts = [contact(1, 1, { city: 'Heidelberg' }), contact(2, 1), contact(3, 3), contact(4, null, { organisation: 'Verband' })]

  it('offers „Alle“, the categories (all of them to whoever maintains the contacts, else those with contacts) and „Vom Träger“', () => {
    expect(contactTabs(categories, contacts, true).map(tab => [tab.key, tab.count])).toEqual([['all', 4], ['1', 2], ['2', 0], ['3', 1], ['provider', 1]])
    expect(contactTabs(categories, contacts, false).map(tab => tab.key)).toEqual(['all', '1', '3', 'provider'])
    expect(contactTabs(categories, contacts.slice(0, 3), false).map(tab => tab.key)).toEqual(['all', '1', '3'])
    const tabs = contactTabs(categories, contacts, false)
    expect(contactTabFromQuery('3', tabs)).toBe('3')
    expect(contactTabFromQuery('2', tabs)).toBe('all')
    expect(contactTabFromQuery(undefined, tabs)).toBe('all')
    expect(tabCategoryName(tabs, '1')).toBe('Schulen')
    expect(tabCategoryName(tabs, 'provider')).toBeNull()
  })

  it('lists the contacts of the tab that match the search', () => {
    expect(contactsOfTab(contacts, 'all').map(entry => entry.id)).toEqual([1, 2, 3, 4])
    expect(contactsOfTab(contacts, '1').map(entry => entry.id)).toEqual([1, 2])
    expect(contactsOfTab(contacts, 'provider').map(entry => entry.id)).toEqual([4])
    expect(contactsOfTab(contacts, 'all', 'heidel').map(entry => entry.id)).toEqual([1])
    expect(contactsOfTab(contacts, '3', 'heidel')).toEqual([])
  })

  it('shows address, website and the printout of a tab', () => {
    expect(contactAddress({ street: 'Hauptstraße 1', postalCode: '69117', city: 'Heidelberg' })).toBe('Hauptstraße 1, 69117 Heidelberg')
    expect(contactAddress({ street: '', postalCode: '', city: 'Heidelberg' })).toBe('Heidelberg')
    expect(contactAddress({ street: '', postalCode: '', city: '' })).toBe('')
    expect(websiteLabel('https://www.schule.de/')).toBe('www.schule.de')
    expect(contactPrintPath('all')).toBe('/print/contacts/all')
    expect(contactPrintPath('3')).toBe('/print/contacts/3')
  })

  it('groups the school children by their future school, alphabetical, „ohne“ last', () => {
    const rows = [
      { id: 1, futureSchool: 'Waldschule' }, { id: 2, futureSchool: null }, { id: 3, futureSchool: 'Grundschule Süd' },
      { id: 4, futureSchool: 'Waldschule' },
    ]
    expect(groupBySchool(rows).map(group => [group.school, group.rows.map(row => row.id)])).toEqual([
      ['Grundschule Süd', [3]], ['Waldschule', [1, 4]], [null, [2]],
    ])
  })
})
