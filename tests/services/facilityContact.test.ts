import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { facilityContacts } from '../../server/db/schema'
import { facilityContactData, getFacilityContact, setFacilityContact } from '../../server/services/facilityContact'
import { telHref, websiteHref, type FacilityContactDto } from '../../shared/domain/facilityContact'
import { addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const full = (more: Partial<FacilityContactDto> = {}): FacilityContactDto => ({
  street: 'Sonnenweg 4', postalCode: '70173', city: 'Stuttgart', website: 'www.kita-sonnenschein.de',
  operator: 'Kita gGmbH', manager: 'Anna Beispiel',
  contacts: [
    { kind: 'phone', value: '0711 / 123 45-0', belongsTo: 'facility', label: 'Büro' },
    { kind: 'phone', value: '+49 170 1234567', belongsTo: 'leitung', label: 'Handy' },
    { kind: 'email', value: 'leitung@kita.de', belongsTo: 'leitung', label: '' },
    { kind: 'email', value: 'info@traeger.de', belongsTo: 'traeger', label: 'Zentrale' },
  ],
  ...more,
})

describe('facility contact data', () => {
  let db: Db
  let traeger: ReturnType<typeof addUser>
  let leitung: ReturnType<typeof addUser>
  beforeEach(() => {
    db = createTestDb()
    traeger = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin')
  })

  it('starts empty for every facility (migration defaults and a new facility)', () => {
    const empty = { street: '', postalCode: '', city: '', website: '', operator: '', manager: '', contacts: [] }
    expect(getFacilityContact(db, traeger, 1)).toEqual(empty)
    const other = addFacility(db, 'Krippe')
    expect(getFacilityContact(db, traeger, other)).toEqual(empty)
    expect(db.select().from(facilityContacts).all()).toEqual([])
  })

  it('round-trips all fields and the contacts in their order', () => {
    setFacilityContact(db, traeger, 1, full())
    expect(getFacilityContact(db, traeger, 1)).toEqual(full())
    // Saving again replaces the list.
    const fewer = full({ contacts: [{ kind: 'email', value: 'neu@kita.de', belongsTo: 'facility', label: '' }] })
    setFacilityContact(db, traeger, 1, fewer)
    expect(getFacilityContact(db, traeger, 1)).toEqual(fewer)
    expect(db.select().from(facilityContacts).all()).toHaveLength(1)
  })

  it('trims texts and keeps the website as typed', () => {
    setFacilityContact(db, traeger, 1, full({
      street: '  Sonnenweg 4 ', website: ' https://kita.de/start ', operator: ' Träger e. V. ',
      contacts: [{ kind: 'phone', value: '  0711 123  ', belongsTo: 'facility', label: ' Büro ' }],
    }))
    const stored = getFacilityContact(db, traeger, 1)
    expect(stored.street).toBe('Sonnenweg 4')
    expect(stored.website).toBe('https://kita.de/start')
    expect(stored.operator).toBe('Träger e. V.')
    expect(stored.contacts).toEqual([{ kind: 'phone', value: '0711 123', belongsTo: 'facility', label: 'Büro' }])
  })

  it('accepts a website with or without https://, and adds it for the link', () => {
    setFacilityContact(db, traeger, 1, full({ website: 'kita.de' }))
    expect(getFacilityContact(db, traeger, 1).website).toBe('kita.de')
    expect(websiteHref('kita.de')).toBe('https://kita.de')
    expect(websiteHref('http://kita.de')).toBe('http://kita.de')
    expect(websiteHref('https://kita.de')).toBe('https://kita.de')
    expect(websiteHref('')).toBe('')
  })

  it('builds tel: links from the number', () => {
    expect(telHref('0711 / 123 45-0')).toBe('tel:0711123450')
    expect(telHref('+49 (0) 170 1234567')).toBe('tel:+491701234567')
  })

  it('rejects bad values with a German-message code and changes nothing', () => {
    setFacilityContact(db, traeger, 1, full())
    const bad = (more: Partial<FacilityContactDto>) => errorCode(() => setFacilityContact(db, traeger, 1, full(more)))
    const contact = (value: string, kind: 'phone' | 'email') => ({ contacts: [{ kind, value, belongsTo: 'facility' as const, label: '' }] })
    expect(bad({ postalCode: '7017' })).toBe('facility_postal_code_invalid')
    expect(bad({ postalCode: '7017a' })).toBe('facility_postal_code_invalid')
    expect(bad({ postalCode: '701733' })).toBe('facility_postal_code_invalid')
    expect(bad({ website: 'kein link' })).toBe('facility_website_invalid')
    expect(bad(contact('kein-email', 'email'))).toBe('facility_contact_email_invalid')
    expect(bad(contact('a@b', 'email'))).toBe('facility_contact_email_invalid')
    expect(bad(contact('a b@kita.de', 'email'))).toBe('facility_contact_email_invalid')
    expect(bad(contact('a@b.de?bcc=x', 'email'))).toBe('facility_contact_email_invalid')
    expect(bad(contact('a@b.de&x', 'email'))).toBe('facility_contact_email_invalid')
    expect(bad(contact('a?b@kita.de', 'email'))).toBe('facility_contact_email_invalid')
    expect(bad(contact('abc', 'phone'))).toBe('facility_contact_phone_invalid')
    expect(bad(contact('12', 'phone'))).toBe('facility_contact_phone_invalid')
    expect(bad(contact('+ / - ()', 'phone'))).toBe('facility_contact_phone_invalid')
    expect(bad(contact('0711 12x', 'phone'))).toBe('facility_contact_phone_invalid')
    expect(bad(contact('', 'phone'))).toBe('facility_contact_value_required')
    expect(bad({ contacts: [{ kind: 'fax' as never, value: '123', belongsTo: 'facility', label: '' }] })).toBe('facility_contact_invalid')
    expect(bad({ contacts: [{ kind: 'phone', value: '123', belongsTo: 'chef' as never, label: '' }] })).toBe('facility_contact_invalid')
    expect(getFacilityContact(db, traeger, 1)).toEqual(full())
  })

  it('accepts an entry without a label field (API clients) and umlaut addresses', () => {
    const entry = { kind: 'email', value: 'büro@kita-süd.de', belongsTo: 'facility' } as never
    setFacilityContact(db, traeger, 1, full({ contacts: [entry] }))
    expect(getFacilityContact(db, traeger, 1).contacts).toEqual([{ kind: 'email', value: 'büro@kita-süd.de', belongsTo: 'facility', label: '' }])
  })

  it('limits the entries (30) and every text (120 characters)', () => {
    const entries = (count: number) => Array.from({ length: count }, (_, index) => (
      { kind: 'phone' as const, value: `0711 ${100 + index}`, belongsTo: 'facility' as const, label: '' }))
    expect(errorCode(() => setFacilityContact(db, traeger, 1, full({ contacts: entries(31) })))).toBe('facility_contact_too_many')
    setFacilityContact(db, traeger, 1, full({ contacts: entries(30) }))
    expect(getFacilityContact(db, traeger, 1).contacts).toHaveLength(30)
    expect(errorCode(() => setFacilityContact(db, traeger, 1, full({ street: 'x'.repeat(121) })))).toBe('facility_contact_text_too_long')
    expect(errorCode(() => setFacilityContact(db, traeger, 1, full({
      contacts: [{ kind: 'phone', value: '0711 123', belongsTo: 'facility', label: 'y'.repeat(121) }],
    })))).toBe('facility_contact_text_too_long')
    setFacilityContact(db, traeger, 1, full({ street: 'x'.repeat(120) }))
    expect(getFacilityContact(db, traeger, 1).street).toHaveLength(120)
  })

  it('accepts plausible phone numbers and an empty address', () => {
    const phones = ['0711 123456', '+49 (0) 711 / 12-34', '089-123']
    setFacilityContact(db, traeger, 1, full({
      postalCode: '', street: '', city: '',
      contacts: phones.map(value => ({ kind: 'phone' as const, value, belongsTo: 'facility' as const, label: '' })),
    }))
    expect(getFacilityContact(db, traeger, 1).contacts.map(entry => entry.value)).toEqual(phones)
  })

  it('is for the Träger to write: Leitung gets 403, nothing changes', () => {
    setFacilityContact(db, traeger, 1, full())
    expect(() => setFacilityContact(db, leitung, 1, full({ street: 'Anders 1' })))
      .toThrow(expect.objectContaining({ statusCode: 403, code: 'forbidden' }))
    expect(getFacilityContact(db, traeger, 1).street).toBe('Sonnenweg 4')
  })

  it('lets the Leitung read the own facility only', () => {
    setFacilityContact(db, traeger, 1, full())
    expect(getFacilityContact(db, leitung, 1)).toEqual(full())
    const other = addFacility(db, 'Krippe')
    setFacilityContact(db, traeger, other, full({ street: 'Andere Straße 9' }))
    expect(() => getFacilityContact(db, leitung, other)).toThrow(expect.objectContaining({ statusCode: 403, code: 'forbidden' }))
    // Another facility's Leitung cannot write the data of facility 1 either.
    const leitungB = addUser(db, 'leitung-b', 'admin', null, other)
    expect(() => setFacilityContact(db, leitungB, 1, full())).toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(getFacilityContact(db, leitungB, other).street).toBe('Andere Straße 9')
  })

  it('keeps the facilities apart and 404s for an unknown one', () => {
    const other = addFacility(db, 'Krippe')
    setFacilityContact(db, traeger, 1, full())
    expect(getFacilityContact(db, traeger, other).contacts).toEqual([])
    expect(errorCode(() => setFacilityContact(db, traeger, 999, full()))).toBe('facility_not_found')
    expect(errorCode(() => getFacilityContact(db, traeger, 999))).toBe('facility_not_found')
  })

  describe('facilityContactData (for printouts, e.g. the accident report)', () => {
    it('gives name, address and the facility phone', () => {
      setFacilityContact(db, traeger, 1, full())
      expect(facilityContactData(db, 1)).toEqual({
        name: 'Kindergarten', street: 'Sonnenweg 4', postalCode: '70173', city: 'Stuttgart',
        address: 'Sonnenweg 4, 70173 Stuttgart', phone: '0711 / 123 45-0', phones: ['0711 / 123 45-0', '+49 170 1234567'],
        website: 'www.kita-sonnenschein.de', operator: 'Kita gGmbH', operatorPhones: [], operatorEmails: ['info@traeger.de'],
        manager: 'Anna Beispiel', managerPhones: ['+49 170 1234567'], managerEmails: ['leitung@kita.de'],
      })
    })

    it('falls back to the first phone, and is empty without data', () => {
      expect(facilityContactData(db, 1)).toEqual({
        name: 'Kindergarten', street: '', postalCode: '', city: '', address: '', phone: '', phones: [], website: '',
        operator: '', operatorPhones: [], operatorEmails: [], manager: '', managerPhones: [], managerEmails: [],
      })
      setFacilityContact(db, traeger, 1, full({
        street: '', contacts: [{ kind: 'phone', value: '0171 99', belongsTo: 'leitung', label: '' }],
      }))
      const data = facilityContactData(db, 1)
      expect(data).toMatchObject({ phone: '0171 99', address: '70173 Stuttgart' })
    })

    it('is null for an unknown facility', () => {
      expect(facilityContactData(db, 999)).toBeNull()
    })
  })
})
