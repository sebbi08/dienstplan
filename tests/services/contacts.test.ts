import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { children, contacts } from '../../server/db/schema'
import { createChild, getChild, moveChildToFacility, updateChildMaster } from '../../server/services/children'
import {
  createContact, createContactCategory, deleteContact, deleteContactCategory, globalContactCategoryNames, listContacts,
  moveContactCategory, renameContactCategory, schoolOptions, staffContactCount, updateContact,
} from '../../server/services/contacts'
import { upcomingSchoolChildren } from '../../server/services/occupancy'
import { DEFAULT_CONTACT_CATEGORIES } from '../../shared/domain/contacts'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { ChildMasterInput, ContactInput, Role } from '../../shared/types/api'
import { addChild, addFacility, addUser, asChildViewer, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-11-20T09:00:00.000Z')

/** A contact with only the organisation and the category filled in. */
const contact = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  organisation: 'Grundschule Süd', person: '', role: '', phone: '', mobile: '', email: '', street: '', postalCode: '', city: '',
  website: '', note: '', visibleToStaff: false, ...overrides,
})

describe('address book (Kontakte)', () => {
  let db: Db
  /** An actor of the role with the role's default permissions, in facility 1 unless named. */
  const as = (role: Role, facilityId = 1, id = 1) => ({ id, role, permissions: permissionsOf(role), facilityId })
  const provider = as('provider')
  const leitung = as('admin', 1, 2)
  const staff = as('observer')
  /** The facility's tablet: no permission of its own. */
  const tablet = { id: 1, role: 'terminal' as Role, permissions: new Set<PermissionKey>(), facilityId: 1 }
  const categoryId = (name: string, facilityId = 1) => listContacts(db, as('admin', facilityId)).categories.find(category => category.name === name)!.id
  const organisations = (viewer: { permissions: ReadonlySet<PermissionKey>; facilityId: number }) =>
    listContacts(db, viewer).contacts.map(entry => entry.organisation)

  beforeEach(() => {
    db = createTestDb()
    addUser(db, 'traeger', 'provider')
    addUser(db, 'leitung', 'admin')
  })

  describe('categories', () => {
    it('starts every facility with the example categories as own copies (existing ones from the migration)', () => {
      expect(DEFAULT_CONTACT_CATEGORIES).toEqual([
        'Schulen', 'Jugendamt', 'Gesundheitsamt', 'Fachberatung', 'Ärztinnen/Ärzte & Therapie', 'Träger & Verwaltung',
        'Handwerk & Notdienst', 'Sonstiges',
      ])
      expect(listContacts(db, leitung).categories.map(category => [category.name, category.contactCount, category.ownCount]))
        .toEqual(DEFAULT_CONTACT_CATEGORIES.map(name => [name, 0, 0]))
      const krippe = addFacility(db, 'Krippe')
      expect(listContacts(db, as('admin', krippe)).categories.map(category => category.name)).toEqual([...DEFAULT_CONTACT_CATEGORIES])
      // Copies: renaming one in the new facility leaves the first facility's alone.
      renameContactCategory(db, as('admin', krippe), categoryId('Schulen', krippe), { name: 'Grundschulen' })
      expect(listContacts(db, as('admin', krippe)).categories[0]!.name).toBe('Grundschulen')
      expect(listContacts(db, leitung).categories[0]!.name).toBe('Schulen')
    })

    it('adds, renames, reorders and deletes empty categories, names unique per facility regardless of case', () => {
      const kita = createContactCategory(db, leitung, { name: '  Kitas im Ort ' })
      expect(listContacts(db, leitung).categories.at(-1)).toEqual({ id: kita, name: 'Kitas im Ort', contactCount: 0, ownCount: 0 })
      expect(errorCode(() => createContactCategory(db, leitung, { name: 'JUGENDAMT' }))).toBe('contact_category_name_taken')
      expect(errorCode(() => createContactCategory(db, leitung, { name: 'sonstiges ' }))).toBe('contact_category_name_taken')
      expect(errorCode(() => createContactCategory(db, leitung, { name: '   ' }))).toBe('contact_category_name_required')
      // Keeping the own name, or changing only its case, is fine.
      renameContactCategory(db, leitung, kita, { name: 'KITAS im Ort' })
      expect(errorCode(() => renameContactCategory(db, leitung, kita, { name: 'Schulen' }))).toBe('contact_category_name_taken')

      moveContactCategory(db, leitung, kita, 'up')
      expect(listContacts(db, leitung).categories.map(category => category.name).slice(-2)).toEqual(['KITAS im Ort', 'Sonstiges'])
      moveContactCategory(db, leitung, categoryId('Schulen'), 'up')
      expect(listContacts(db, leitung).categories[0]!.name).toBe('Schulen')

      createContact(db, leitung, contact({ categoryId: kita, organisation: 'Kita Nord' }), NOW)
      expect(listContacts(db, leitung).categories.find(category => category.id === kita)).toMatchObject({ contactCount: 1, ownCount: 1 })
      expect(errorCode(() => deleteContactCategory(db, leitung, kita))).toBe('contact_category_not_empty')
      deleteContactCategory(db, leitung, categoryId('Fachberatung'))
      expect(listContacts(db, leitung).categories.map(category => category.name)).not.toContain('Fachberatung')
    })

    it('keeps each facility to its own categories and lets only contacts.manage change them', () => {
      const krippe = addFacility(db, 'Krippe')
      const foreign = categoryId('Jugendamt', krippe)
      expect(errorCode(() => renameContactCategory(db, leitung, foreign, { name: 'X' }))).toBe('contact_category_not_found')
      expect(errorCode(() => moveContactCategory(db, leitung, foreign, 'down'))).toBe('contact_category_not_found')
      expect(errorCode(() => deleteContactCategory(db, leitung, foreign))).toBe('contact_category_not_found')
      expect(errorCode(() => createContactCategory(db, staff, { name: 'X' }))).toBe('forbidden')
      expect(errorCode(() => renameContactCategory(db, staff, categoryId('Jugendamt'), { name: 'X' }))).toBe('forbidden')
      // The same name in another facility is fine.
      createContactCategory(db, leitung, { name: 'Vereine' })
      createContactCategory(db, as('admin', krippe), { name: 'Vereine' })
    })
  })

  describe('contacts', () => {
    it('creates, changes and deletes contacts with trimmed fields, the website with https:// in front', () => {
      const id = createContact(db, leitung, contact({
        categoryId: categoryId('Schulen'), organisation: '  Grundschule Süd ', person: 'Frau Kern', role: 'Kooperationslehrerin',
        phone: '06221 12345', email: ' sekretariat@gs-sued.de ', website: 'www.gs-sued.de', city: 'Heidelberg', note: 'Kooperation dienstags',
      }), NOW)
      const [stored] = listContacts(db, leitung).contacts
      expect(stored).toMatchObject({
        id, categoryId: categoryId('Schulen'), global: false, globalCategoryName: null, organisation: 'Grundschule Süd',
        person: 'Frau Kern', role: 'Kooperationslehrerin', email: 'sekretariat@gs-sued.de', website: 'https://www.gs-sued.de',
        visibleToStaff: false, updatedAt: NOW.toISOString(), updatedBy: 'leitung', canEdit: true,
      })
      updateContact(db, provider, id, contact({ categoryId: categoryId('Sonstiges'), organisation: 'GS Süd', website: 'http://gs.de' }), NOW)
      expect(listContacts(db, leitung).contacts[0]).toMatchObject({
        categoryId: categoryId('Sonstiges'), organisation: 'GS Süd', website: 'http://gs.de', person: '', updatedBy: 'traeger',
      })
      deleteContact(db, leitung, id)
      expect(listContacts(db, leitung).contacts).toEqual([])
    })

    it('needs an organisation, a valid e-mail address, an http(s) website and a category of the facility', () => {
      const schools = categoryId('Schulen')
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: schools, organisation: '  ' })))).toBe('contact_organisation_required')
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: schools, email: 'kein-at.de' })))).toBe('contact_email_invalid')
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: schools, email: 'a b@c.de' })))).toBe('contact_email_invalid')
      for (const website of ['javascript:alert(1)', 'ftp://schule.de', 'mailto:a@b.de', 'schule', 'www.schule .de']) {
        expect(errorCode(() => createContact(db, leitung, contact({ categoryId: schools, website }))), website).toBe('contact_website_invalid')
      }
      expect(errorCode(() => createContact(db, leitung, contact({})))).toBe('contact_category_invalid')
      const krippe = addFacility(db, 'Krippe')
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: categoryId('Schulen', krippe) })))).toBe('contact_category_invalid')
      expect(errorCode(() => createContact(db, staff, contact({ categoryId: schools })))).toBe('forbidden')
    })

    it('shows Mitarbeiter accounts and the tablet only the contacts marked for the staff', () => {
      const schools = categoryId('Schulen')
      createContact(db, leitung, contact({ categoryId: schools, organisation: 'Grundschule Süd', visibleToStaff: true }), NOW)
      createContact(db, leitung, contact({ categoryId: categoryId('Jugendamt'), organisation: 'Jugendamt Heidelberg' }), NOW)
      expect(organisations(leitung)).toEqual(['Grundschule Süd', 'Jugendamt Heidelberg'])
      expect(organisations(staff)).toEqual(['Grundschule Süd'])
      expect(organisations(tablet)).toEqual(['Grundschule Süd'])
      const forStaff = listContacts(db, staff)
      expect(forStaff).toMatchObject({ canManage: false, canManageGlobal: false })
      expect(forStaff.contacts[0]!.canEdit).toBe(false)
      // Who changed it when is for the managers only: no login names at the tablet or for the staff.
      for (const viewer of [staff, tablet]) {
        expect(listContacts(db, viewer).contacts.map(entry => [entry.updatedBy, entry.updatedAt])).toEqual([[null, '']])
      }
      expect(listContacts(db, leitung).contacts[0]).toMatchObject({ updatedBy: 'leitung', updatedAt: NOW.toISOString() })
      expect(forStaff.categories.find(category => category.id === schools)).toMatchObject({ contactCount: 1, ownCount: 0 })
      expect(forStaff.categories.find(category => category.name === 'Jugendamt')).toMatchObject({ contactCount: 0 })
      expect(staffContactCount(db, 1)).toBe(1)
      expect(listContacts(db, leitung)).toMatchObject({ canManage: true, canManageGlobal: false })
      expect(listContacts(db, provider)).toMatchObject({ canManage: true, canManageGlobal: true })
    })

    it('hides a contact for all facilities without the mark from the staff and the tablet of every facility', () => {
      const krippe = addFacility(db, 'Krippe')
      createContact(db, provider, contact({ scope: 'all', categoryName: 'Jugendamt', organisation: 'Kreisjugendamt' }), NOW)
      expect(organisations(leitung)).toEqual(['Kreisjugendamt'])
      expect(organisations(as('admin', krippe))).toEqual(['Kreisjugendamt'])
      for (const viewer of [staff, tablet, as('observer', krippe), as('group_lead', krippe)]) expect(organisations(viewer)).toEqual([])
      expect(listContacts(db, staff).categories.find(category => category.name === 'Jugendamt')).toMatchObject({ contactCount: 0 })
      expect(staffContactCount(db, 1)).toBe(0)
      expect(staffContactCount(db, krippe)).toBe(0)
    })

    it('keeps each facility to its own contacts', () => {
      const krippe = addFacility(db, 'Krippe')
      const foreign = createContact(db, as('admin', krippe), contact({ categoryId: categoryId('Schulen', krippe), visibleToStaff: true }), NOW)
      expect(organisations(leitung)).toEqual([])
      expect(organisations(staff)).toEqual([])
      expect(staffContactCount(db, 1)).toBe(0)
      expect(errorCode(() => updateContact(db, leitung, foreign, contact({ categoryId: categoryId('Schulen') })))).toBe('address_contact_not_found')
      expect(errorCode(() => deleteContact(db, leitung, foreign))).toBe('address_contact_not_found')
      expect(errorCode(() => deleteContact(db, provider, foreign))).toBe('address_contact_not_found')
    })

    it('files a contact for all facilities by category name: the facility\'s category of that name, else „Vom Träger“', () => {
      const krippe = addFacility(db, 'Krippe')
      renameContactCategory(db, as('admin', krippe), categoryId('Fachberatung', krippe), { name: 'Beratung' })
      expect(errorCode(() => createContact(db, leitung, contact({ scope: 'all', categoryName: 'Fachberatung' })))).toBe('forbidden')
      const id = createContact(db, provider, contact({ scope: 'all', categoryName: ' FACHBERATUNG ', organisation: 'Fachberatung Träger', visibleToStaff: true }), NOW)
      expect(errorCode(() => createContact(db, provider, contact({ scope: 'all', categoryName: '  ' })))).toBe('contact_category_name_required')
      // Facility 1 has „Fachberatung“: it shows there; the Krippe renamed it: „Vom Träger“.
      expect(listContacts(db, leitung).contacts[0]).toMatchObject({
        id, categoryId: categoryId('Fachberatung'), global: true, globalCategoryName: 'FACHBERATUNG', canEdit: false,
      })
      expect(listContacts(db, as('admin', krippe)).contacts[0]).toMatchObject({ id, categoryId: null, global: true })
      expect(listContacts(db, leitung).categories.find(category => category.name === 'Fachberatung')).toMatchObject({ contactCount: 1, ownCount: 0 })
      // Mitarbeiter of every facility see it (marked for the staff); the category of that name can still be deleted.
      expect(organisations(as('observer', krippe))).toEqual(['Fachberatung Träger'])
      expect(staffContactCount(db, krippe)).toBe(1)
      deleteContactCategory(db, leitung, categoryId('Fachberatung'))
      expect(listContacts(db, leitung).contacts[0]!.categoryId).toBeNull()
      // Only the Träger changes and deletes it; it stays for all facilities.
      expect(errorCode(() => updateContact(db, leitung, id, contact({ categoryName: 'Fachberatung' })))).toBe('forbidden')
      expect(errorCode(() => deleteContact(db, leitung, id))).toBe('forbidden')
      updateContact(db, provider, id, contact({ categoryName: 'Beratung', organisation: 'Fachberatung' }), NOW)
      expect(listContacts(db, as('admin', krippe)).contacts[0]).toMatchObject({ categoryId: categoryId('Beratung', krippe), globalCategoryName: 'Beratung' })
      expect(globalContactCategoryNames(db, provider)).toContain('Beratung')
      expect(globalContactCategoryNames(db, provider).filter(name => name.toLowerCase() === 'schulen')).toEqual(['Schulen'])
      expect(errorCode(() => globalContactCategoryNames(db, leitung))).toBe('forbidden')
      deleteContact(db, provider, id)
      expect(db.select().from(contacts).all()).toEqual([])
    })

    it('orders by category, „Vom Träger“ last, then by organisation', () => {
      createContact(db, leitung, contact({ categoryId: categoryId('Jugendamt'), organisation: 'Zentrale' }), NOW)
      createContact(db, leitung, contact({ categoryId: categoryId('Jugendamt'), organisation: 'Außenstelle' }), NOW)
      createContact(db, leitung, contact({ categoryId: categoryId('Schulen'), organisation: 'Realschule' }), NOW)
      createContact(db, provider, contact({ scope: 'all', categoryName: 'Verbände', organisation: 'Arbeitskreis' }), NOW)
      expect(organisations(leitung)).toEqual(['Realschule', 'Außenstelle', 'Zentrale', 'Arbeitskreis'])
    })
  })

  describe('the future school of a child', () => {
    const TODAY = '2027-04-01'
    const master = (overrides: Partial<ChildMasterInput> = {}): ChildMasterInput => ({
      lastName: 'Meier', firstName: 'Lena', birthDate: '2021-03-15', address: '', groupId: null, careTypeId: null,
      entryDate: '2024-09-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
      schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'contract', waitlistedOn: null, ...overrides,
    })

    it('offers the contacts of school categories of the facility and for all facilities', () => {
      const krippe = addFacility(db, 'Krippe')
      const sued = createContact(db, leitung, contact({ categoryId: categoryId('Schulen'), organisation: 'Grundschule Süd', city: 'Heidelberg' }), NOW)
      const hort = createContactCategory(db, leitung, { name: 'Schule & Hort' })
      const nord = createContact(db, leitung, contact({ categoryId: hort, organisation: 'Grundschule Nord' }), NOW)
      createContact(db, leitung, contact({ categoryId: categoryId('Jugendamt'), organisation: 'Jugendamt' }), NOW)
      const foreign = createContact(db, as('admin', krippe), contact({ categoryId: categoryId('Schulen', krippe), organisation: 'Krippenschule' }), NOW)
      const all = createContact(db, provider, contact({ scope: 'all', categoryName: 'Grundschulen', organisation: 'Waldschule' }), NOW)
      createContact(db, provider, contact({ scope: 'all', categoryName: 'Verbände', organisation: 'Verband' }), NOW)
      expect(schoolOptions(db, 1)).toEqual([
        { id: nord, name: 'Grundschule Nord' }, { id: sued, name: 'Grundschule Süd, Heidelberg' }, { id: all, name: 'Waldschule' },
      ])
      // Another facility's school is refused as the future school, on create and on save.
      const actor = asChildViewer(addUser(db, 'leitung3', 'admin'))
      expect(errorCode(() => createChild(db, actor, 1, master({ futureSchoolContactId: foreign }), NOW))).toBe('future_school_invalid')
      const id = createChild(db, actor, 1, master({ futureSchoolContactId: all }), NOW)
      expect(errorCode(() => updateChildMaster(db, actor, 1, id, master({ futureSchoolContactId: foreign }), '2027-04-01', NOW)))
        .toBe('future_school_invalid')
      expect(getChild(db, actor, id, '2027-04-01').master.futureSchoolContactId).toBe(all)
    })

    it('stores the school with the record, shows it in the list of school children and clears it with the contact', () => {
      const actor = asChildViewer(addUser(db, 'leitung2', 'admin'))
      const sued = createContact(db, leitung, contact({ categoryId: categoryId('Schulen'), organisation: 'Grundschule Süd', city: 'Heidelberg' }), NOW)
      const amt = createContact(db, leitung, contact({ categoryId: categoryId('Jugendamt'), organisation: 'Jugendamt' }), NOW)
      const id = createChild(db, actor, 1, master({ futureSchoolContactId: sued }), NOW)
      expect(getChild(db, actor, id, TODAY)).toMatchObject({ master: { futureSchoolContactId: sued }, futureSchoolName: 'Grundschule Süd, Heidelberg' })
      expect(upcomingSchoolChildren(db, 1, TODAY)).toEqual([expect.objectContaining({ id, futureSchool: 'Grundschule Süd, Heidelberg' })])

      // Left out: the stored one stays; null clears it; no school category: refused.
      updateChildMaster(db, actor, 1, id, master({ note: 'x' }), TODAY, NOW)
      expect(getChild(db, actor, id, TODAY).master.futureSchoolContactId).toBe(sued)
      expect(errorCode(() => updateChildMaster(db, actor, 1, id, master({ futureSchoolContactId: amt }), TODAY, NOW))).toBe('future_school_invalid')
      expect(errorCode(() => createChild(db, actor, 1, master({ futureSchoolContactId: 9999 }), NOW))).toBe('future_school_invalid')
      // A school whose category was renamed since stays when saved unchanged.
      renameContactCategory(db, leitung, categoryId('Schulen'), { name: 'Bildung' })
      updateChildMaster(db, actor, 1, id, master({ futureSchoolContactId: sued }), TODAY, NOW)
      renameContactCategory(db, leitung, categoryId('Bildung'), { name: 'Schulen' })

      deleteContact(db, leitung, sued)
      expect(getChild(db, actor, id, TODAY)).toMatchObject({ master: { futureSchoolContactId: null }, futureSchoolName: null })
      expect(upcomingSchoolChildren(db, 1, TODAY)[0]!.futureSchool).toBeNull()
      updateChildMaster(db, actor, 1, id, master({ futureSchoolContactId: null }), TODAY, NOW)
    })

    it('keeps a school for all facilities when the child moves, not one of the old facility', () => {
      const krippe = addFacility(db, 'Krippe')
      const own = createContact(db, leitung, contact({ categoryId: categoryId('Schulen') }), NOW)
      const all = createContact(db, provider, contact({ scope: 'all', categoryName: 'Schulen', organisation: 'Waldschule' }), NOW)
      const first = addChild(db, 1, { birthDate: '2023-01-01' })
      const second = addChild(db, 1, { birthDate: '2023-01-01' })
      db.update(children).set({ futureSchoolContactId: own }).where(eq(children.id, first)).run()
      db.update(children).set({ futureSchoolContactId: all }).where(eq(children.id, second)).run()
      moveChildToFacility(db, first, krippe, NOW)
      moveChildToFacility(db, second, krippe, NOW)
      const schoolOf = (id: number) => db.select({ school: children.futureSchoolContactId }).from(children).where(eq(children.id, id)).get()!.school
      expect(schoolOf(first)).toBeNull()
      expect(schoolOf(second)).toBe(all)
    })
  })
})
