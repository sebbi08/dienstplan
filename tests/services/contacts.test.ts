import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { children, contacts, contactTargets, facilities } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { createChild, getChild, moveChildToFacility, updateChildMaster } from '../../server/services/children'
import {
  contactForScope, createContact, createContactCategory, deleteContact, deleteContactCategory, globalContactCategoryNames, listContacts,
  moveContactCategory, renameContactCategory, schoolOptions, staffContactCount, updateContact,
} from '../../server/services/contacts'
import { readerHomeGroup } from '../../server/services/documentTargets'
import { deleteGroup } from '../../server/services/groups'
import { upcomingSchoolChildren } from '../../server/services/occupancy'
import { globalSchoolOptions } from '../../server/services/schoolDistricts'
import { unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { DEFAULT_CONTACT_CATEGORIES } from '../../shared/domain/contacts'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { ChildMasterInput, ContactInput, Role } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-11-20T09:00:00.000Z')

/** A contact with only the organisation and the category filled in. */
const contact = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  organisation: 'Grundschule Süd', person: '', role: '', phone: '', mobile: '', email: '', street: '', postalCode: '', city: '',
  website: '', note: '', visibility: 'managers', ...overrides,
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
  const organisations = (viewer: { role: Role; permissions: ReadonlySet<PermissionKey>; facilityId: number }) =>
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
      expect(listContacts(db, leitung).categories.at(-1)).toEqual({ id: kita, name: 'Kitas im Ort', visibility: 'all', contactCount: 0, ownCount: 0 })
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

  describe('„Wer sieht sie?“ at the category (as for „Zum Ausdrucken“ and „Wissen“)', () => {
    it('hides a category for Leitung and Träger with its contacts from the staff and the tablet, whatever the contact says', () => {
      const office = createContactCategory(db, leitung, { name: 'Intern', visibility: 'managers' })
      createContact(db, leitung, contact({ categoryId: office, organisation: 'Steuerbüro', visibility: 'all' }), NOW)
      createContact(db, leitung, contact({ categoryId: categoryId('Schulen'), organisation: 'Grundschule Süd', visibility: 'all' }), NOW)
      expect(organisations(leitung)).toEqual(['Grundschule Süd', 'Steuerbüro'])
      for (const viewer of [staff, tablet]) {
        expect(organisations(viewer)).toEqual(['Grundschule Süd'])
        // The category's name does not reach them either.
        expect(listContacts(db, viewer).categories.map(category => category.name)).not.toContain('Intern')
      }
      expect(staffContactCount(db, staff)).toBe(1)
      expect(listContacts(db, leitung).categories.find(category => category.id === office)).toMatchObject({ visibility: 'managers', contactCount: 1 })
      // Back to all: the contact's own mark decides again.
      renameContactCategory(db, leitung, office, { name: 'Intern', visibility: 'all' })
      expect(organisations(staff)).toEqual(['Grundschule Süd', 'Steuerbüro'])
      // Without `visibility` a rename keeps it.
      renameContactCategory(db, leitung, office, { name: 'Büro', visibility: 'managers' })
      renameContactCategory(db, leitung, office, { name: 'Büro intern' })
      expect(listContacts(db, leitung).categories.find(category => category.id === office)).toMatchObject({ name: 'Büro intern', visibility: 'managers' })
    })

    it('keeps a category for the Träger alone from the Leitung: not listed, not usable, 404 to change; the Leitung cannot set it', () => {
      expect(errorCode(() => createContactCategory(db, leitung, { name: 'Geheim', visibility: 'provider' }))).toBe('forbidden')
      expect(errorCode(() => renameContactCategory(db, leitung, categoryId('Schulen'), { name: 'Schulen', visibility: 'provider' }))).toBe('forbidden')
      const secret = createContactCategory(db, provider, { name: 'Geheim', visibility: 'provider' })
      createContact(db, provider, contact({ categoryId: secret, organisation: 'Anwaltskanzlei', visibility: 'all' }), NOW)
      // A contact for all facilities filed by that name is hidden from the Leitung there, too (the stricter wins).
      createContact(db, provider, contact({ scope: 'all', categoryName: 'geheim', organisation: 'Gutachter', visibility: 'all' }), NOW)
      expect(organisations(provider)).toEqual(['Anwaltskanzlei', 'Gutachter'])
      expect(organisations(leitung)).toEqual([])
      expect(organisations(staff)).toEqual([])
      expect(listContacts(db, leitung).categories.map(category => category.id)).not.toContain(secret)
      expect(errorCode(() => renameContactCategory(db, leitung, secret, { name: 'X' }))).toBe('contact_category_not_found')
      expect(errorCode(() => deleteContactCategory(db, leitung, secret))).toBe('contact_category_not_found')
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: secret })))).toBe('contact_category_invalid')
      const own = listContacts(db, provider).contacts.find(entry => entry.organisation === 'Anwaltskanzlei')!.id
      expect(errorCode(() => updateContact(db, leitung, own, contact({ categoryId: categoryId('Schulen') })))).toBe('address_contact_not_found')
      // The name stays taken (also for the Leitung).
      expect(errorCode(() => createContactCategory(db, leitung, { name: 'GEHEIM' }))).toBe('contact_category_name_taken')
    })

    it('moves a category past ones the Leitung does not see without changing their place', () => {
      createContactCategory(db, provider, { name: 'Geheim', visibility: 'provider' })
      const last = createContactCategory(db, leitung, { name: 'Vereine' })
      moveContactCategory(db, leitung, last, 'up')
      const names = (viewer: typeof leitung) => listContacts(db, viewer).categories.map(category => category.name)
      expect(names(leitung).slice(-2)).toEqual(['Vereine', 'Sonstiges'])
      expect(names(provider).slice(-3)).toEqual(['Vereine', 'Geheim', 'Sonstiges'])
    })

    it('gives a category created for a contact of the Träger the visibility of the acting facility\'s category of that name', () => {
      const krippe = addFacility(db, 'Krippe')
      createContactCategory(db, provider, { name: 'Verbände', visibility: 'managers' })
      createContact(db, provider, contact({ scope: 'all', categoryName: 'Verbände', organisation: 'Paritätischer', createCategories: true }), NOW)
      expect(listContacts(db, as('admin', krippe)).categories.find(category => category.name === 'Verbände')).toMatchObject({ visibility: 'managers' })
    })

    it('keeps a contact of the Träger set to „Nur Träger“ hidden also where a facility has no category of its name', () => {
      // Kita 1 has „Geheim“ for the Träger alone, the Krippe (and any later facility) none: there it shows under „Vom Träger“.
      const krippe = addFacility(db, 'Krippe')
      createContactCategory(db, provider, { name: 'Geheim', visibility: 'provider' })
      const open = createContact(db, provider, contact({ scope: 'all', categoryName: 'Geheim', organisation: 'Gutachter', visibility: 'all' }), NOW)
      expect(organisations(as('admin', krippe))).toEqual(['Gutachter'])
      expect(organisations(as('observer', krippe))).toEqual(['Gutachter'])
      // Set to „Nur Träger“ itself, it is the Träger's everywhere, whatever the facility's categories.
      updateContact(db, provider, open, contact({ categoryName: 'Geheim', organisation: 'Gutachter', visibility: 'provider' }), NOW)
      for (const viewer of [leitung, staff, tablet, as('admin', krippe), as('observer', krippe)]) expect(organisations(viewer)).toEqual([])
      expect(organisations(as('provider', krippe))).toEqual(['Gutachter'])
      expect(listContacts(db, as('provider', krippe)).contacts[0]).toMatchObject({ categoryId: null, visibility: 'provider' })
      expect(staffContactCount(db, as('observer', krippe))).toBe(0)
    })

    it('lets only the Träger set „Nur Träger“ on a contact', () => {
      const schools = categoryId('Schulen')
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: schools, visibility: 'provider' })))).toBe('forbidden')
      const id = createContact(db, leitung, contact({ categoryId: schools, organisation: 'Grundschule Süd', visibility: 'managers' }), NOW)
      expect(errorCode(() => updateContact(db, leitung, id, contact({ categoryId: schools, visibility: 'provider' })))).toBe('forbidden')
      // The Träger may; then the Leitung no longer sees (nor changes) the facility's own contact.
      updateContact(db, provider, id, contact({ categoryId: schools, organisation: 'Grundschule Süd', visibility: 'provider' }), NOW)
      expect(organisations(leitung)).toEqual([])
      expect(errorCode(() => deleteContact(db, leitung, id))).toBe('address_contact_not_found')
      expect(organisations(provider)).toEqual(['Grundschule Süd'])
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
        visibility: 'managers', updatedAt: NOW.toISOString(), updatedBy: 'leitung', canEdit: true,
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
      createContact(db, leitung, contact({ categoryId: schools, organisation: 'Grundschule Süd', visibility: 'all' }), NOW)
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
      expect(staffContactCount(db, staff)).toBe(1)
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
      expect(staffContactCount(db, staff)).toBe(0)
      expect(staffContactCount(db, as('observer', krippe))).toBe(0)
    })

    it('keeps each facility to its own contacts', () => {
      const krippe = addFacility(db, 'Krippe')
      const foreign = createContact(db, as('admin', krippe), contact({ categoryId: categoryId('Schulen', krippe), visibility: 'all' }), NOW)
      expect(organisations(leitung)).toEqual([])
      expect(organisations(staff)).toEqual([])
      expect(staffContactCount(db, staff)).toBe(0)
      expect(errorCode(() => updateContact(db, leitung, foreign, contact({ categoryId: categoryId('Schulen') })))).toBe('address_contact_not_found')
      expect(errorCode(() => deleteContact(db, leitung, foreign))).toBe('address_contact_not_found')
      expect(errorCode(() => deleteContact(db, provider, foreign))).toBe('address_contact_not_found')
    })

    it('files a contact for all facilities by category name: the facility\'s category of that name, else „Vom Träger“', () => {
      const krippe = addFacility(db, 'Krippe')
      renameContactCategory(db, as('admin', krippe), categoryId('Fachberatung', krippe), { name: 'Beratung' })
      expect(errorCode(() => createContact(db, leitung, contact({ scope: 'all', categoryName: 'Fachberatung' })))).toBe('forbidden')
      const id = createContact(db, provider, contact({ scope: 'all', categoryName: ' FACHBERATUNG ', organisation: 'Fachberatung Träger', visibility: 'all' }), NOW)
      expect(errorCode(() => createContact(db, provider, contact({ scope: 'all', categoryName: '  ' })))).toBe('contact_category_name_required')
      // Facility 1 has „Fachberatung“: it shows there; the Krippe renamed it: „Vom Träger“.
      expect(listContacts(db, leitung).contacts[0]).toMatchObject({
        id, categoryId: categoryId('Fachberatung'), global: true, globalCategoryName: 'FACHBERATUNG', canEdit: false,
      })
      expect(listContacts(db, as('admin', krippe)).contacts[0]).toMatchObject({ id, categoryId: null, global: true })
      expect(listContacts(db, leitung).categories.find(category => category.name === 'Fachberatung')).toMatchObject({ contactCount: 1, ownCount: 0 })
      // Mitarbeiter of every facility see it (marked for the staff); the category of that name can still be deleted.
      expect(organisations(as('observer', krippe))).toEqual(['Fachberatung Träger'])
      expect(staffContactCount(db, as('observer', krippe))).toBe(1)
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

  describe('„Gilt für“ (facilities and groups)', () => {
    /** A viewer of the role with the given home group (none: null), in facility 1 unless named. */
    const reader = (role: Role, homeGroupId: number | null, facilityId = 1) => ({ ...as(role, facilityId), homeGroupId })

    it('shows the staff a contact only when it is for the staff and for all groups or their home group; managers see every one', () => {
      const baeren = addGroup(db, 1, 'Bären')
      const fuechse = addGroup(db, 1, 'Füchse')
      const maeuse = addGroup(db, addFacility(db, 'Krippe'), 'Mäuse')
      const schools = categoryId('Schulen')
      createContact(db, leitung, contact({ categoryId: schools, organisation: 'Alle Gruppen', visibility: 'all' }), NOW)
      createContact(db, leitung, contact({ categoryId: schools, organisation: 'Nur Bären', visibility: 'all', groupTargets: [{ facilityId: 1, groupIds: [baeren] }] }), NOW)
      createContact(db, leitung, contact({ categoryId: schools, organisation: 'Bären intern', groupTargets: [{ facilityId: 1, groupIds: [baeren] }] }), NOW)
      createContact(db, leitung, contact({ categoryId: schools, organisation: 'Intern' }), NOW)
      const matrix: [string, ReturnType<typeof reader> | typeof tablet & { homeGroupId: number | null }, string[]][] = [
        ['Leitung', reader('admin', null), ['Alle Gruppen', 'Bären intern', 'Intern', 'Nur Bären']],
        ['Träger', reader('provider', null), ['Alle Gruppen', 'Bären intern', 'Intern', 'Nur Bären']],
        ['Mitarbeiter der Bären', reader('observer', baeren), ['Alle Gruppen', 'Nur Bären']],
        ['Mitarbeiter der Füchse', reader('observer', fuechse), ['Alle Gruppen']],
        ['Gruppenleitung der Bären', reader('group_lead', baeren), ['Alle Gruppen', 'Nur Bären']],
        ['Gruppenleitung der Füchse', reader('group_lead', fuechse), ['Alle Gruppen']],
        // Helpers and accounts without a home group: only those for all groups.
        ['ohne Stammgruppe', reader('observer', null), ['Alle Gruppen']],
        ['Aushilfe aus der Krippe', reader('observer', maeuse), ['Alle Gruppen']],
        ['Tablet entsperrt (Aushilfe aus der Krippe)', { ...tablet, homeGroupId: maeuse }, ['Alle Gruppen']],
        // The tablet: locked no group, unlocked the unlocking person's.
        ['Tablet gesperrt', { ...tablet, homeGroupId: null }, ['Alle Gruppen']],
        ['Tablet entsperrt (Bären)', { ...tablet, homeGroupId: baeren }, ['Alle Gruppen', 'Nur Bären']],
      ]
      for (const [who, viewer, expected] of matrix) {
        expect(organisations(viewer).sort((a, b) => a.localeCompare(b, 'de')), who).toEqual(expected)
        expect(staffContactCount(db, viewer), who).toBe(expected.length)
      }
      // The category counts follow what the viewer sees.
      expect(listContacts(db, reader('observer', fuechse)).categories.find(category => category.id === schools)!.contactCount).toBe(1)
      expect(listContacts(db, reader('observer', baeren)).categories.find(category => category.id === schools)!.contactCount).toBe(2)
    })

    it('follows the person who unlocked the tablet (the reader\'s home group from the unlock), none while locked', () => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      const baeren = addGroup(db, 1, 'Bären')
      const bea = addEmployee(db, 'Bea Bär', { groupId: baeren })
      setPin(db, 1, bea, '123456')
      const device = addUser(db, 'tablet', 'terminal')
      createContact(db, leitung, contact({ categoryId: categoryId('Schulen'), organisation: 'Alle', visibility: 'all' }), NOW)
      createContact(db, leitung, contact({
        categoryId: categoryId('Schulen'), organisation: 'Nur Bären', visibility: 'all', groupTargets: [{ facilityId: 1, groupIds: [baeren] }],
      }), NOW)
      const atTablet = (token?: string) => organisations({ ...tablet, id: device.id, homeGroupId: readerHomeGroup(db, device, token, NOW) })
      expect(atTablet()).toEqual(['Alle'])
      const { token } = unlockChildren(db, { id: device.id, facilityId: 1 }, bea, '123456', NOW)
      expect(atTablet(token)).toEqual(['Alle', 'Nur Bären'])
      expect(atTablet('falsch')).toEqual(['Alle'])
    })

    it('asks for a group when a contact whose chosen groups are all gone is saved as it is; never widens it to all groups', () => {
      const eulen = addGroup(db, 1, 'Eulen')
      const schools = categoryId('Schulen')
      const id = createContact(db, leitung, contact({ categoryId: schools, organisation: 'Eulenschule', visibility: 'all', groupTargets: [{ facilityId: 1, groupIds: [eulen] }] }), NOW)
      deleteGroup(db, 1, eulen, '2026-11-20')
      expect(listContacts(db, leitung).contacts[0]!.targets).toMatchObject({ groupNames: [], groupTargets: [{ facilityId: 1, groupIds: [] }] })
      expect(organisations(reader('observer', null))).toEqual([])
      expect(errorCode(() => updateContact(db, leitung, id, contact({ categoryId: schools, organisation: 'Eulenschule', visibility: 'all' }), NOW)))
        .toBe('document_targets_no_group')
      updateContact(db, leitung, id, contact({ categoryId: schools, organisation: 'Eulenschule', visibility: 'all', scope: 'facility', groupTargets: [] }), NOW)
      expect(organisations(reader('observer', null))).toEqual(['Eulenschule'])
    })

    it('limits a contact of the Träger to the chosen facilities and their groups, with hints for the managers only', () => {
      const krippe = addFacility(db, 'Krippe')
      const hort = addFacility(db, 'Hort')
      const maeuse = addGroup(db, krippe, 'Mäuse')
      const igel = addGroup(db, krippe, 'Igel')
      const id = createContact(db, provider, contact({
        scope: 'selected', facilityIds: [1, krippe], groupTargets: [{ facilityId: krippe, groupIds: [maeuse] }],
        categoryName: 'Jugendamt', organisation: 'Kreisjugendamt', visibility: 'all',
      }), NOW)
      expect(organisations(leitung)).toEqual(['Kreisjugendamt'])
      expect(organisations(reader('observer', null))).toEqual(['Kreisjugendamt'])
      expect(organisations(as('admin', hort))).toEqual([])
      expect(organisations(reader('observer', maeuse, krippe))).toEqual(['Kreisjugendamt'])
      expect(organisations(reader('observer', igel, krippe))).toEqual([])
      expect(organisations(as('admin', krippe))).toEqual(['Kreisjugendamt'])
      // Managers get the hints; the Träger the full choice; the staff nothing of it.
      expect(listContacts(db, as('admin', krippe)).contacts[0]).toMatchObject({
        global: true, allFacilities: false, canEdit: false, targets: { facilityNames: expect.arrayContaining(['Krippe']), groupNames: ['Mäuse'] },
      })
      expect(listContacts(db, as('provider', krippe)).contacts[0]!.targets).toMatchObject({
        scope: 'selected', facilityIds: [1, krippe], groupTargets: [{ facilityId: krippe, groupIds: [maeuse] }],
      })
      expect(listContacts(db, reader('observer', maeuse, krippe)).contacts[0]!.targets).toBeNull()
      // The scope changes: now the Hort only; the Krippe loses it.
      updateContact(db, provider, id, contact({ scope: 'selected', facilityIds: [hort], categoryName: 'Jugendamt', organisation: 'Kreisjugendamt', visibility: 'all' }), NOW)
      expect(organisations(as('admin', krippe))).toEqual([])
      expect(organisations(as('admin', hort))).toEqual(['Kreisjugendamt'])
      // Saved without „Gilt für“ (from a facility it is for): kept as it is.
      updateContact(db, as('provider', hort), id, contact({ categoryName: 'Jugendamt', organisation: 'Kreisjugendamt (neu)' }), NOW)
      expect(organisations(as('admin', hort))).toEqual(['Kreisjugendamt (neu)'])
      expect(listContacts(db, as('provider', hort)).contacts[0]!.targets).toMatchObject({ scope: 'selected', facilityIds: [hort] })
      // For all facilities again.
      updateContact(db, as('provider', hort), id, contact({ scope: 'all', categoryName: 'Jugendamt', organisation: 'Kreisjugendamt' }), NOW)
      expect(listContacts(db, leitung).contacts[0]).toMatchObject({ allFacilities: true })
      expect(organisations(as('admin', krippe))).toEqual(['Kreisjugendamt'])
    })

    it('lets only the Träger reach beyond the own facility; the Leitung limits its own contacts to its groups', () => {
      const krippe = addFacility(db, 'Krippe')
      const baeren = addGroup(db, 1, 'Bären')
      const maeuse = addGroup(db, krippe, 'Mäuse')
      const schools = categoryId('Schulen')
      expect(errorCode(() => createContact(db, leitung, contact({ scope: 'selected', facilityIds: [1], categoryName: 'Schulen' })))).toBe('forbidden')
      expect(errorCode(() => createContact(db, leitung, contact({ scope: 'all', categoryName: 'Schulen' })))).toBe('forbidden')
      // Groups only of the own facility.
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: schools, groupTargets: [{ facilityId: krippe, groupIds: [maeuse] }] }))))
        .toBe('document_targets_invalid')
      expect(errorCode(() => createContact(db, leitung, contact({ categoryId: schools, groupTargets: [{ facilityId: 1, groupIds: [maeuse] }] }))))
        .toBe('document_targets_invalid')
      expect(errorCode(() => createContact(db, provider, contact({ scope: 'selected', facilityIds: [], categoryName: 'Schulen' }))))
        .toBe('document_targets_no_facility')
      const own = createContact(db, leitung, contact({ categoryId: schools, groupTargets: [{ facilityId: 1, groupIds: [baeren] }] }), NOW)
      expect(listContacts(db, leitung).contacts[0]!.targets).toMatchObject({ scope: 'facility', groupTargets: [{ facilityId: 1, groupIds: [baeren] }], groupNames: ['Bären'] })
      // The Leitung cannot turn its contact into one for several facilities; the Träger can, and back.
      expect(errorCode(() => updateContact(db, leitung, own, contact({ scope: 'all', categoryName: 'Schulen' })))).toBe('forbidden')
      updateContact(db, provider, own, contact({ scope: 'selected', facilityIds: [krippe], categoryName: 'Schulen' }), NOW)
      expect(organisations(leitung)).toEqual([])
      expect(listContacts(db, as('admin', krippe)).contacts[0]).toMatchObject({ global: true, categoryId: categoryId('Schulen', krippe) })
      updateContact(db, as('provider', krippe), own, contact({ scope: 'facility', categoryId: categoryId('Schulen', krippe) }), NOW)
      expect(listContacts(db, as('admin', krippe)).contacts[0]).toMatchObject({ global: false, canEdit: true })
      expect(organisations(leitung)).toEqual([])
    })

    it('keeps a contact whose chosen facilities are all gone for the Träger only, and asks for a facility when it is saved', () => {
      const krippe = addFacility(db, 'Krippe')
      const id = createContact(db, provider, contact({ scope: 'selected', facilityIds: [krippe], categoryName: 'Schulen', organisation: 'Waise' }), NOW)
      // The facility is deleted (directly; its rows go with it).
      db.run(sql`PRAGMA foreign_keys = OFF`)
      db.delete(facilities).where(eq(facilities.id, krippe)).run()
      db.run(sql`PRAGMA foreign_keys = ON`)
      db.delete(contactTargets).where(eq(contactTargets.facilityId, krippe)).run()
      expect(organisations(leitung)).toEqual([])
      // Not a school of the Träger's district list any more (for no facility), flagged where it is linked.
      expect(globalSchoolOptions(db)).toEqual([])
      expect(contactForScope(db, null, id)).toBe(false)
      expect(listContacts(db, provider).contacts[0]).toMatchObject({ id, categoryId: null, targets: { scope: 'selected', facilityIds: [], facilityNames: [] } })
      // Saved as it is: a clear message; with a facility again it shows there.
      expect(errorCode(() => updateContact(db, provider, id, contact({ categoryName: 'Schulen', organisation: 'Waise' })))).toBe('document_targets_no_facility')
      expect(errorCode(() => updateContact(db, leitung, id, contact({ categoryName: 'Schulen' })))).toBe('address_contact_not_found')
      updateContact(db, provider, id, contact({ scope: 'selected', facilityIds: [1], categoryName: 'Schulen', organisation: 'Waise' }), NOW)
      expect(organisations(leitung)).toEqual(['Waise'])
      expect(globalSchoolOptions(db)).toEqual([{ id, name: 'Waise' }])
      expect([contactForScope(db, null, id), contactForScope(db, 1, id), contactForScope(db, krippe, id)]).toEqual([true, true, false])
    })

    it('offers as future schools only the Träger\'s schools for the child\'s facility, and flags a linked one no longer for it', () => {
      const krippe = addFacility(db, 'Krippe')
      const baeren = addGroup(db, 1, 'Bären')
      const here = createContact(db, provider, contact({ scope: 'selected', facilityIds: [1], categoryName: 'Schulen', organisation: 'Hierschule' }), NOW)
      const there = createContact(db, provider, contact({ scope: 'selected', facilityIds: [krippe], categoryName: 'Schulen', organisation: 'Dortschule' }), NOW)
      // Groups do not matter for this link.
      const grouped = createContact(db, leitung, contact({ categoryId: categoryId('Schulen'), organisation: 'Bärenschule', groupTargets: [{ facilityId: 1, groupIds: [baeren] }] }), NOW)
      expect(schoolOptions(db, 1).map(option => option.id)).toEqual([grouped, here])
      expect(schoolOptions(db, krippe).map(option => option.id)).toEqual([there])
      const actor = asChildViewer(addUser(db, 'leitung3', 'admin'))
      const master = {
        lastName: 'Meier', firstName: 'Lena', birthDate: '2021-03-15', address: '', groupId: null, careTypeId: null, entryDate: '2024-09-01',
        plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '', schoolDistrict: '', keyEducatorId: null,
        note: '', admissionStatus: 'contract' as const, waitlistedOn: null,
      }
      expect(errorCode(() => createChild(db, actor, 1, { ...master, futureSchoolContactId: there }, NOW))).toBe('future_school_invalid')
      const child = createChild(db, actor, 1, { ...master, futureSchoolContactId: here }, NOW)
      expect(getChild(db, actor, child, '2027-04-01')).toMatchObject({ futureSchoolName: 'Hierschule', futureSchoolOutOfScope: false })
      expect(upcomingSchoolChildren(db, 1, '2027-04-01')).toEqual([expect.objectContaining({ id: child, futureSchool: 'Hierschule', futureSchoolOutOfScope: false })])
      // The Träger moves the school to the Krippe: it stays linked, with the hint, and can be saved unchanged.
      updateContact(db, provider, here, contact({ scope: 'selected', facilityIds: [krippe], categoryName: 'Schulen', organisation: 'Hierschule' }), NOW)
      expect(getChild(db, actor, child, '2027-04-01')).toMatchObject({
        master: { futureSchoolContactId: here }, futureSchoolName: 'Hierschule', futureSchoolOutOfScope: true,
      })
      expect(upcomingSchoolChildren(db, 1, '2027-04-01')).toEqual([expect.objectContaining({ id: child, futureSchool: 'Hierschule', futureSchoolOutOfScope: true })])
      updateChildMaster(db, actor, 1, child, { ...master, futureSchoolContactId: here }, '2027-04-01', NOW)
      expect(schoolOptions(db, 1).map(option => option.id)).toEqual([grouped])
      // A move keeps a school of the Träger only when it is for the new facility.
      moveChildToFacility(db, child, krippe, NOW)
      expect(db.select({ school: children.futureSchoolContactId }).from(children).where(eq(children.id, child)).get()!.school).toBe(here)
      const other = addChild(db, krippe, { birthDate: '2023-01-01' })
      db.update(children).set({ futureSchoolContactId: there }).where(eq(children.id, other)).run()
      moveChildToFacility(db, other, 1, NOW)
      expect(db.select({ school: children.futureSchoolContactId }).from(children).where(eq(children.id, other)).get()!.school).toBeNull()
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

    it('offers schools for the Träger alone only to the Träger; one linked before stays readable', () => {
      const secret = createContactCategory(db, provider, { name: 'Schulen intern', visibility: 'provider' })
      const hidden = createContact(db, provider, contact({ categoryId: secret, organisation: 'Geheime Privatschule' }), NOW)
      const own = createContact(db, provider, contact({ scope: 'all', categoryName: 'Schulen', organisation: 'Träger-Schule', visibility: 'provider' }), NOW)
      // „Nur Leitung und Träger“ stays a name everyone editing the record may choose (as before).
      const internal = createContact(db, leitung, contact({ categoryId: categoryId('Schulen'), organisation: 'Realschule', visibility: 'managers' }), NOW)
      expect(schoolOptions(db, 1).map(option => option.id)).toEqual([internal])
      expect(schoolOptions(db, 1, true).map(option => option.id)).toEqual([hidden, internal, own])
      expect(globalSchoolOptions(db)).toEqual([])
      expect(globalSchoolOptions(db, true).map(option => option.id)).toEqual([own])
      const leitungViewer = asChildViewer(addUser(db, 'leitung4', 'admin'))
      const traeger = asChildViewer(addUser(db, 'traeger2', 'provider'))
      expect(errorCode(() => createChild(db, leitungViewer, 1, master({ futureSchoolContactId: hidden }), NOW))).toBe('future_school_invalid')
      const id = createChild(db, traeger, 1, master({ futureSchoolContactId: hidden }), NOW)
      // The Leitung saves the record unchanged: the stored school stays, with its name.
      updateChildMaster(db, leitungViewer, 1, id, master({ futureSchoolContactId: hidden, note: 'x' }), TODAY, NOW)
      expect(getChild(db, leitungViewer, id, TODAY)).toMatchObject({ master: { futureSchoolContactId: hidden }, futureSchoolName: 'Geheime Privatschule' })
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
