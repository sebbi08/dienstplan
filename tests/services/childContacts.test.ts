import { beforeEach, describe, expect, it } from 'vitest'
import type { ChildContactInput } from '../../shared/types/api'
import type { Db } from '../../server/db/client'
import { addContact, deleteContact, reorderContacts, updateContact } from '../../server/services/childContacts'
import { getChild } from '../../server/services/children'
import type { FacilityUser } from '../../server/utils/auth'
import { addChild, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-09'
const NOW = new Date('2026-10-09T08:30:00.000Z')

const contact = (overrides: Partial<ChildContactInput> = {}): ChildContactInput => ({
  name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: true,
  mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '', ...overrides,
})

describe('contacts of a child', () => {
  let db: Db
  let admin: FacilityUser
  let childId: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin') as FacilityUser
    childId = addChild(db, 1)
  })

  const contactsOf = (id = childId) => getChild(db, admin, id, TODAY).contacts

  it('appends contacts in order and stamps the contacts section with the actor', () => {
    const first = addContact(db, admin, 1, childId, contact({ name: '  Anna  ', emergencyRank: 1 }), TODAY, NOW)
    const second = addContact(db, admin, 1, childId, contact({ name: 'Bernd', relation: 'Vater' }), TODAY, NOW)
    const record = getChild(db, admin, childId, TODAY)
    expect(record.contacts).toEqual([
      { id: first, ...contact({ name: 'Anna', emergencyRank: 1 }) },
      { id: second, ...contact({ name: 'Bernd', relation: 'Vater' }) },
    ])
    expect(record.stamps.contacts).toEqual({ updatedAt: NOW.toISOString(), updatedBy: 'leitung' })
  })

  it('updates and deletes a contact', () => {
    const id = addContact(db, admin, 1, childId, contact(), TODAY, NOW)
    const keep = addContact(db, admin, 1, childId, contact({ name: 'Bernd' }), TODAY, NOW)
    const later = new Date('2026-10-10T07:00:00.000Z')
    updateContact(db, admin, 1, id, contact({ name: 'Anna Schulz', phoneWork: '030 1', emergencyRank: 2 }), TODAY, later)
    expect(contactsOf()[0]).toMatchObject({ id, name: 'Anna Schulz', phoneWork: '030 1', emergencyRank: 2 })
    expect(getChild(db, admin, childId, TODAY).stamps.contacts.updatedAt).toBe(later.toISOString())
    deleteContact(db, admin, 1, id, TODAY, later)
    expect(contactsOf().map(item => item.id)).toEqual([keep])
  })

  it('reorders contacts, ids must be exactly the child\'s contacts', () => {
    const a = addContact(db, admin, 1, childId, contact({ name: 'A' }), TODAY, NOW)
    const b = addContact(db, admin, 1, childId, contact({ name: 'B' }), TODAY, NOW)
    const c = addContact(db, admin, 1, childId, contact({ name: 'C' }), TODAY, NOW)
    reorderContacts(db, admin, 1, childId, [c, a, b], TODAY, NOW)
    expect(contactsOf().map(item => item.name)).toEqual(['C', 'A', 'B'])
    const otherChild = addChild(db, 1)
    const foreign = addContact(db, admin, 1, otherChild, contact({ name: 'Fremd' }), TODAY, NOW)
    expect(errorCode(() => reorderContacts(db, admin, 1, childId, [c, a], TODAY, NOW))).toBe('invalid_order')
    expect(errorCode(() => reorderContacts(db, admin, 1, childId, [c, a, b, b], TODAY, NOW))).toBe('invalid_order')
    expect(errorCode(() => reorderContacts(db, admin, 1, childId, [c, a, foreign], TODAY, NOW))).toBe('invalid_order')
    expect(contactsOf().map(item => item.name)).toEqual(['C', 'A', 'B'])
  })

  it('appends after the last contact also when earlier ones were deleted', () => {
    const a = addContact(db, admin, 1, childId, contact({ name: 'A' }), TODAY, NOW)
    addContact(db, admin, 1, childId, contact({ name: 'B' }), TODAY, NOW)
    deleteContact(db, admin, 1, a, TODAY, NOW)
    addContact(db, admin, 1, childId, contact({ name: 'C' }), TODAY, NOW)
    expect(contactsOf().map(item => item.name)).toEqual(['B', 'C'])
  })

  it('requires a name', () => {
    expect(errorCode(() => addContact(db, admin, 1, childId, contact({ name: '   ' }), TODAY, NOW)))
      .toBe('contact_name_required')
    const id = addContact(db, admin, 1, childId, contact(), TODAY, NOW)
    expect(errorCode(() => updateContact(db, admin, 1, id, contact({ name: '' }), TODAY, NOW))).toBe('contact_name_required')
  })

  it('rejects a contact ban together with pick-up permission or an emergency rank, and without a note', () => {
    const ban = { contactBan: true, contactBanNote: 'gerichtlich' }
    expect(errorCode(() => addContact(db, admin, 1, childId, contact({ ...ban, mayPickUp: true }), TODAY, NOW)))
      .toBe('contact_ban_conflict')
    expect(errorCode(() => addContact(db, admin, 1, childId, contact({ ...ban, mayPickUp: false, emergencyRank: 1 }), TODAY, NOW)))
      .toBe('contact_ban_conflict')
    expect(errorCode(() => addContact(db, admin, 1, childId, contact({ contactBan: true, mayPickUp: false, contactBanNote: '  ' }), TODAY, NOW)))
      .toBe('contact_ban_note_required')
    const id = addContact(db, admin, 1, childId, contact({ ...ban, mayPickUp: false }), TODAY, NOW)
    expect(contactsOf()[0]).toMatchObject({ id, contactBan: true, contactBanNote: 'gerichtlich' })
    expect(errorCode(() => updateContact(db, admin, 1, id, contact({ ...ban, mayPickUp: true }), TODAY, NOW)))
      .toBe('contact_ban_conflict')
  })

  it('answers not_found for contacts and children of another facility', () => {
    const other = addFacility(db, 'Andere Kita')
    const otherAdmin = addUser(db, 'andere-leitung', 'admin', null, other) as FacilityUser
    const foreignChild = addChild(db, other)
    const foreignContact = addContact(db, otherAdmin, other, foreignChild, contact(), TODAY, NOW)
    expect(errorCode(() => updateContact(db, admin, 1, foreignContact, contact(), TODAY, NOW))).toBe('contact_not_found')
    expect(errorCode(() => deleteContact(db, admin, 1, foreignContact, TODAY, NOW))).toBe('contact_not_found')
    expect(errorCode(() => updateContact(db, admin, 1, 9999, contact(), TODAY, NOW))).toBe('contact_not_found')
    expect(errorCode(() => addContact(db, admin, 1, foreignChild, contact(), TODAY, NOW))).toBe('child_not_found')
    expect(errorCode(() => reorderContacts(db, admin, 1, foreignChild, [foreignContact], TODAY, NOW))).toBe('child_not_found')
    expect(getChild(db, otherAdmin, foreignChild, TODAY).contacts).toHaveLength(1)
  })

  it('rejects every change for an archived child with child_archived', () => {
    const archived = addChild(db, 1, { leftOn: '2026-09-30' })
    expect(errorCode(() => addContact(db, admin, 1, archived, contact(), TODAY, NOW))).toBe('child_archived')
    expect(errorCode(() => reorderContacts(db, admin, 1, archived, [], TODAY, NOW))).toBe('child_archived')
    // A child who was still active when the contact was added and has left since
    const left = addChild(db, 1, { leftOn: '2026-10-01' })
    const leftContact = addContact(db, admin, 1, left, contact(), '2026-10-01', NOW)
    expect(errorCode(() => updateContact(db, admin, 1, leftContact, contact(), TODAY, NOW))).toBe('child_archived')
    expect(errorCode(() => deleteContact(db, admin, 1, leftContact, TODAY, NOW))).toBe('child_archived')
  })
})
