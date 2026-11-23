import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { templateCategories } from '../../server/db/schema'
import { DEFAULT_TEMPLATE_CATEGORIES } from '../../server/db/seed'
import {
  knowledgeCategorySchema, knowledgeCategoryUpdateSchema, templateCategorySchema, templateCategoryUpdateSchema,
} from '../../server/schemas'
import { uploadTemplate } from '../../server/services/printTemplates'
import {
  createCategory, deleteCategory, globalCategoryNames, listCategories, moveCategory, updateCategory,
} from '../../server/services/templateCategories'
import type { TemplateVisibility } from '../../shared/domain/templateCategories'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const pdf = Buffer.from('%PDF-1.7\ncontent')

describe('template categories', () => {
  let db: Db
  /** An actor of the role with the role's default permissions, in facility 1 unless named. */
  const as = (role: Role, facilityId = 1) => ({ role, permissions: permissionsOf(role), facilityId })
  const provider = as('provider')
  const leitung = as('admin')
  const create = (
    by: { role: Role; permissions: ReadonlySet<PermissionKey>; facilityId: number }, name: string, visibility: TemplateVisibility = 'all',
  ) => createCategory(db, by, { name, visibility })
  const names = (role: Role, facilityId = 1) => listCategories(db, { role, facilityId }).map(category => category.name)

  it('starts a new database and every new facility with the default categories, visible to all, as own copies', () => {
    const fresh = createTestDb()
    expect(DEFAULT_TEMPLATE_CATEGORIES).toEqual(['Eingewöhnungsmappe', 'Mitarbeitermappe', 'Eltern', 'Gesundheit', 'Personal'])
    expect(listCategories(fresh, leitung).map(category => [category.name, category.visibility, category.templateCount]))
      .toEqual(DEFAULT_TEMPLATE_CATEGORIES.map(name => [name, 'all', 0]))
    const krippe = addFacility(fresh, 'Krippe')
    const copies = listCategories(fresh, as('admin', krippe))
    expect(copies.map(category => [category.name, category.visibility])).toEqual(DEFAULT_TEMPLATE_CATEGORIES.map(name => [name, 'all']))
    // Copies: renaming one in the new facility leaves the first facility's alone.
    updateCategory(fresh, as('admin', krippe), copies[2]!.id, { name: 'Elternbriefe', visibility: 'all' })
    const namesIn = (facilityId: number) => listCategories(fresh, { role: 'admin', facilityId }).map(category => category.name)
    expect(namesIn(krippe)[2]).toBe('Elternbriefe')
    expect(namesIn(1)[2]).toBe('Eltern')
  })

  beforeEach(() => {
    db = createTestDb()
    // The tests below start without the default categories.
    db.delete(templateCategories).run()
  })

  describe('create and list', () => {
    it('adds categories at the end, with the name trimmed, and lists them in their order', () => {
      const eltern = create(leitung, '  Eltern ')
      create(provider, 'Personal', 'managers')
      expect(listCategories(db, provider)).toEqual([
        { id: eltern, parentId: null, name: 'Eltern', visibility: 'all', templateCount: 0, globalCount: 0, hiddenSubcategories: 0 },
        { id: expect.any(Number), parentId: null, name: 'Personal', visibility: 'managers', templateCount: 0, globalCount: 0, hiddenSubcategories: 0 },
      ])
    })

    it('needs a name and keeps names unique per facility regardless of case, umlauts and ß/ss included', () => {
      expect(errorCode(() => create(leitung, '   '))).toBe('template_category_name_required')
      create(leitung, 'Eltern')
      expect(errorCode(() => create(leitung, 'eltern'))).toBe('template_category_name_taken')
      expect(errorCode(() => create(provider, ' ELTERN '))).toBe('template_category_name_taken')
      create(leitung, 'Ärztliches')
      expect(errorCode(() => create(leitung, 'ärztliches'))).toBe('template_category_name_taken')
      create(leitung, 'Straße')
      expect(errorCode(() => create(leitung, 'STRASSE'))).toBe('template_category_name_taken')
      expect(names('provider')).toEqual(['Eltern', 'Ärztliches', 'Straße'])
      // Another facility has a list of its own.
      const krippe = addFacility(db, 'Krippe')
      db.delete(templateCategories).run()
      create(as('admin', krippe), 'Eltern')
      expect(names('admin', krippe)).toEqual(['Eltern'])
    })

    it('lets a category keep its own name, also beside a case twin from before the categories', () => {
      const id = create(leitung, 'Übungen')
      // A twin the free-text categories could leave behind (the database index folds ASCII letters only).
      const twin = db.insert(templateCategories).values({ facilityId: 1, name: 'übungen', sortOrder: 9 }).returning().get().id
      updateCategory(db, leitung, id, { name: 'Übungen', visibility: 'managers' })
      updateCategory(db, leitung, twin, { name: 'übungen', visibility: 'all' })
      expect(listCategories(db, leitung).map(category => [category.name, category.visibility]))
        .toEqual([['Übungen', 'managers'], ['übungen', 'all']])
      // Renaming one into the other's name is a clash.
      expect(errorCode(() => updateCategory(db, leitung, twin, { name: 'ÜBUNGEN', visibility: 'all' }))).toBe('template_category_name_taken')
    })

    it('shows each viewer only the categories of their level', () => {
      create(provider, 'Alle', 'all')
      create(provider, 'Leitung', 'managers')
      create(provider, 'Träger', 'provider')
      expect(names('provider')).toEqual(['Alle', 'Leitung', 'Träger'])
      expect(names('admin')).toEqual(['Alle', 'Leitung'])
      expect(names('observer')).toEqual(['Alle'])
      expect(names('terminal')).toEqual(['Alle'])
    })

    it('counts the facility\'s own templates in a category', () => {
      const used = create(leitung, 'Eltern')
      create(leitung, 'Leer')
      const user = addUser(db, 'leitung', 'admin')
      uploadTemplate(db, { ...user, facilityId: 1 }, { title: 'Brief', categoryId: used, scope: 'facility' }, { data: pdf, filename: 'brief.pdf' })
      expect(listCategories(db, leitung).map(category => [category.name, category.templateCount])).toEqual([['Eltern', 1], ['Leer', 0]])
    })

    it('counts the Träger\'s templates for all facilities shown in a category by name, those the viewer sees', () => {
      create(provider, 'Personal', 'managers')
      create(leitung, 'Eltern')
      const traeger = { ...addUser(db, 'traeger', 'provider'), facilityId: 1 }
      const forAll = (title: string, categoryName: string, visibility: TemplateVisibility = 'all') =>
        uploadTemplate(db, traeger, { title, categoryName, visibility, scope: 'all' }, { data: pdf, filename: 'x.pdf' })
      forAll('Urlaubsantrag', ' personal ')
      forAll('Dienstreise', 'Personal', 'managers')
      forAll('Nur Träger', 'Personal', 'provider')
      forAll('Speiseplan', 'Küche')
      const counts = (role: Role) => listCategories(db, { role, facilityId: 1 }).map(category => [category.name, category.templateCount, category.globalCount])
      expect(counts('provider')).toEqual([['Personal', 0, 3], ['Eltern', 0, 0]])
      expect(counts('admin')).toEqual([['Personal', 0, 2], ['Eltern', 0, 0]])
      // A new facility's own „Personal“ (a default category) shows them as well.
      const krippe = addFacility(db, 'Krippe')
      expect(listCategories(db, { role: 'admin', facilityId: krippe }).find(category => category.name === 'Personal')!.globalCount).toBe(2)
    })

    it('lets only the Träger create a category for the Träger alone', () => {
      expect(errorCode(() => create(leitung, 'Geheim', 'provider'))).toBe('forbidden')
      create(leitung, 'Leitung', 'managers')
      create(provider, 'Geheim', 'provider')
      expect(names('provider')).toEqual(['Leitung', 'Geheim'])
    })

    it('refuses Mitarbeiter and the tablet', () => {
      expect(errorCode(() => create(as('observer'), 'X'))).toBe('forbidden')
      expect(errorCode(() => create(as('terminal'), 'X'))).toBe('forbidden')
    })
  })

  describe('facility isolation', () => {
    it('treats another facility\'s category as missing (change, move, delete)', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(templateCategories).run()
      const theirs = create(as('admin', krippe), 'Krippenbriefe')
      create(leitung, 'Eltern')
      expect(names('admin', 1)).toEqual(['Eltern'])
      expect(errorCode(() => updateCategory(db, leitung, theirs, { name: 'X', visibility: 'all' }))).toBe('template_category_not_found')
      expect(errorCode(() => moveCategory(db, leitung, theirs, 'up'))).toBe('template_category_not_found')
      expect(errorCode(() => deleteCategory(db, leitung, theirs))).toBe('template_category_not_found')
      expect(errorCode(() => updateCategory(db, provider, theirs, { name: 'X', visibility: 'all' }))).toBe('template_category_not_found')
      expect(names('admin', krippe)).toEqual(['Krippenbriefe'])
    })

    it('files a facility\'s template only in a category of that facility', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(templateCategories).run()
      const theirs = create(as('admin', krippe), 'Krippenbriefe')
      const user = addUser(db, 'leitung', 'admin')
      expect(errorCode(() => uploadTemplate(db, { ...user, facilityId: 1 }, { title: 'Brief', categoryId: theirs, scope: 'facility' },
        { data: pdf, filename: 'brief.pdf' }))).toBe('template_category_invalid')
    })
  })

  describe('change', () => {
    it('renames and changes the visibility, unique names again', () => {
      const id = create(leitung, 'Eltern')
      create(leitung, 'Personal')
      updateCategory(db, leitung, id, { name: ' Elternbriefe ', visibility: 'managers' })
      expect(listCategories(db, leitung)[0]).toMatchObject({ id, name: 'Elternbriefe', visibility: 'managers' })
      // The own name in another case is no clash.
      updateCategory(db, leitung, id, { name: 'ELTERNBRIEFE', visibility: 'managers' })
      expect(errorCode(() => updateCategory(db, leitung, id, { name: 'personal', visibility: 'all' }))).toBe('template_category_name_taken')
      expect(errorCode(() => updateCategory(db, leitung, id, { name: '', visibility: 'all' }))).toBe('template_category_name_required')
      expect(errorCode(() => updateCategory(db, leitung, 999, { name: 'X', visibility: 'all' }))).toBe('template_category_not_found')
    })

    it('keeps the Leitung away from the Träger\'s categories and from making one the Träger\'s', () => {
      const own = create(leitung, 'Eltern')
      const traeger = create(provider, 'Geheim', 'provider')
      expect(errorCode(() => updateCategory(db, leitung, own, { name: 'Eltern', visibility: 'provider' }))).toBe('forbidden')
      expect(errorCode(() => updateCategory(db, leitung, traeger, { name: 'Offen', visibility: 'all' }))).toBe('template_category_not_found')
      expect(errorCode(() => deleteCategory(db, leitung, traeger))).toBe('template_category_not_found')
      expect(errorCode(() => moveCategory(db, leitung, traeger, 'up'))).toBe('template_category_not_found')
      updateCategory(db, provider, traeger, { name: 'Offen', visibility: 'all' })
      updateCategory(db, provider, own, { name: 'Eltern', visibility: 'provider' })
      expect(listCategories(db, provider).map(category => [category.name, category.visibility]))
        .toEqual([['Eltern', 'provider'], ['Offen', 'all']])
    })
  })

  describe('order', () => {
    it('moves a category up and down, and stays put at the ends', () => {
      const a = create(leitung, 'A')
      create(leitung, 'B')
      const c = create(leitung, 'C')
      moveCategory(db, leitung, c, 'up')
      expect(names('admin')).toEqual(['A', 'C', 'B'])
      moveCategory(db, leitung, a, 'down')
      expect(names('admin')).toEqual(['C', 'A', 'B'])
      moveCategory(db, leitung, c, 'up')
      moveCategory(db, leitung, db.select().from(templateCategories).all().find(row => row.name === 'B')!.id, 'down')
      expect(names('admin')).toEqual(['C', 'A', 'B'])
    })

    it('moves the Leitung\'s categories past the Träger\'s hidden ones', () => {
      const a = create(provider, 'A')
      create(provider, 'Geheim', 'provider')
      const b = create(provider, 'B')
      moveCategory(db, leitung, b, 'up')
      expect(names('admin')).toEqual(['B', 'A'])
      expect(names('provider')).toEqual(['B', 'Geheim', 'A'])
      moveCategory(db, leitung, a, 'up')
      expect(names('provider')).toEqual(['A', 'Geheim', 'B'])
    })

    it('orders each facility on its own', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(templateCategories).run()
      create(leitung, 'A')
      const b = create(leitung, 'B')
      create(as('admin', krippe), 'X')
      create(as('admin', krippe), 'Y')
      moveCategory(db, leitung, b, 'up')
      expect(names('admin')).toEqual(['B', 'A'])
      expect(names('admin', krippe)).toEqual(['X', 'Y'])
    })
  })

  describe('delete', () => {
    it('deletes an empty category only; a template for all facilities filed by its name does not count', () => {
      const used = create(leitung, 'Eltern')
      const empty = create(leitung, 'Leer')
      const user = addUser(db, 'leitung', 'admin')
      const traeger = addUser(db, 'traeger', 'provider')
      uploadTemplate(db, { ...user, facilityId: 1 }, { title: 'Brief', categoryId: used, scope: 'facility' },
        { data: pdf, filename: 'brief.pdf' })
      uploadTemplate(db, { ...traeger, facilityId: 1 }, { title: 'Für alle', categoryName: 'Leer', scope: 'all' },
        { data: pdf, filename: 'alle.pdf' })
      expect(errorCode(() => deleteCategory(db, leitung, used))).toBe('template_category_not_empty')
      deleteCategory(db, leitung, empty)
      expect(names('admin')).toEqual(['Eltern'])
      expect(errorCode(() => deleteCategory(db, leitung, empty))).toBe('template_category_not_found')
    })
  })

  describe('names for templates for all facilities', () => {
    it('offers the Träger every name a facility uses, once regardless of case, alphabetical', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(templateCategories).run()
      create(leitung, 'Personal')
      create(leitung, 'Eltern')
      create(as('admin', krippe), 'eltern')
      create(as('admin', krippe), 'Ärztliches')
      expect(globalCategoryNames(db, provider).map(entry => entry.name)).toEqual(['Ärztliches', 'Eltern', 'Personal'])
      expect(errorCode(() => globalCategoryNames(db, leitung))).toBe('forbidden')
    })
  })

  describe('subcategories (one level)', () => {
    const sub = (
      by: { role: Role; permissions: ReadonlySet<PermissionKey>; facilityId: number }, parentId: number, name: string,
      visibility: TemplateVisibility = 'all',
    ) => createCategory(db, by, { name, visibility, parentId })
    const tree = (role: Role, facilityId = 1) => listCategories(db, { role, facilityId })
      .map(category => (category.parentId === null ? category.name : `  ${category.name}`))

    it('adds a subcategory at the end of its category and lists each category followed by its subcategories', () => {
      const eltern = create(leitung, 'Eltern')
      const personal = create(leitung, 'Personal')
      const briefe = sub(leitung, eltern, 'Briefe')
      sub(leitung, personal, 'Urlaub')
      sub(leitung, eltern, 'Ausflüge')
      expect(tree('admin')).toEqual(['Eltern', '  Briefe', '  Ausflüge', 'Personal', '  Urlaub'])
      expect(listCategories(db, leitung).find(category => category.id === briefe))
        .toEqual({ id: briefe, parentId: eltern, name: 'Briefe', visibility: 'all', templateCount: 0, globalCount: 0, hiddenSubcategories: 0 })
      // A new category still goes to the end of the categories.
      create(leitung, 'Gesundheit')
      expect(tree('admin').filter(name => !name.startsWith(' '))).toEqual(['Eltern', 'Personal', 'Gesundheit'])
    })

    it('allows one level only, in a category of the same facility the editor sees', () => {
      const eltern = create(leitung, 'Eltern')
      const briefe = sub(leitung, eltern, 'Briefe')
      expect(errorCode(() => sub(leitung, briefe, 'Enkel'))).toBe('template_category_parent_invalid')
      expect(errorCode(() => sub(leitung, 999, 'Waise'))).toBe('template_category_parent_invalid')
      const krippe = addFacility(db, 'Krippe')
      expect(errorCode(() => sub(as('admin', krippe), eltern, 'Fremd'))).toBe('template_category_parent_invalid')
      const geheim = create(provider, 'Geheim', 'provider')
      expect(errorCode(() => sub(leitung, geheim, 'Versteckt'))).toBe('template_category_parent_invalid')
      expect(errorCode(() => sub(as('observer'), eltern, 'X'))).toBe('forbidden')
    })

    it('keeps names unique per category regardless of case; the same name may stand under another category or at the top', () => {
      const eltern = create(leitung, 'Eltern')
      const personal = create(leitung, 'Personal')
      sub(leitung, eltern, 'Formulare')
      expect(errorCode(() => sub(leitung, eltern, ' FORMULARE '))).toBe('template_category_name_taken')
      sub(leitung, personal, 'Formulare')
      create(leitung, 'Formulare')
      expect(errorCode(() => create(leitung, 'formulare'))).toBe('template_category_name_taken')
      const urlaub = sub(leitung, personal, 'Urlaub')
      expect(errorCode(() => updateCategory(db, leitung, urlaub, { name: 'formulare', visibility: 'all' }))).toBe('template_category_name_taken')
      // Renaming keeps it where it is (a subcategory of its category).
      updateCategory(db, leitung, urlaub, { name: 'Urlaubsanträge', visibility: 'managers' })
      expect(listCategories(db, leitung).find(category => category.id === urlaub)).toMatchObject({ parentId: personal, name: 'Urlaubsanträge' })
    })

    it('shows a subcategory only with its category: the stricter visibility of both applies', () => {
      const eltern = create(provider, 'Eltern', 'managers')
      sub(provider, eltern, 'Offen')
      const offen = create(provider, 'Offen')
      sub(provider, offen, 'Leitung', 'managers')
      const geheim = create(provider, 'Geheim', 'provider')
      const drin = sub(provider, geheim, 'Drin')
      expect(tree('observer')).toEqual(['Offen'])
      expect(tree('admin')).toEqual(['Eltern', '  Offen', 'Offen', '  Leitung'])
      expect(tree('provider')).toEqual(['Eltern', '  Offen', 'Offen', '  Leitung', 'Geheim', '  Drin'])
      // The Leitung cannot touch a subcategory of the Träger's category (404).
      expect(errorCode(() => updateCategory(db, leitung, drin, { name: 'X', visibility: 'all' }))).toBe('template_category_not_found')
      expect(errorCode(() => moveCategory(db, leitung, drin, 'up'))).toBe('template_category_not_found')
      expect(errorCode(() => deleteCategory(db, leitung, drin))).toBe('template_category_not_found')
    })

    it('tells the Leitung that a category holds subcategories it does not see (it cannot delete the category)', () => {
      const offen = create(provider, 'Offen')
      sub(provider, offen, 'Nur Träger', 'provider')
      sub(provider, offen, 'Alle')
      const hidden = (role: Role) => listCategories(db, { role, facilityId: 1 }).find(category => category.id === offen)!.hiddenSubcategories
      expect(hidden('admin')).toBe(1)
      expect(hidden('observer')).toBe(1)
      expect(hidden('provider')).toBe(0)
      expect(errorCode(() => deleteCategory(db, leitung, offen))).toBe('template_category_has_subcategories')
    })

    it('refuses a parent when a category is changed (the PUT body), takes it when one is created', () => {
      expect(templateCategoryUpdateSchema.safeParse({ name: 'X', visibility: 'all', parentId: 3 }).success).toBe(false)
      expect(templateCategoryUpdateSchema.safeParse({ name: 'X', visibility: 'all' }).success).toBe(true)
      expect(templateCategorySchema.parse({ name: 'X', visibility: 'all', parentId: 3 })).toEqual({ name: 'X', visibility: 'all', parentId: 3 })
      expect(knowledgeCategoryUpdateSchema.safeParse({ name: 'X', visibility: 'all', parentId: 3 }).success).toBe(false)
      expect(knowledgeCategorySchema.parse({ name: 'X', visibility: 'all', parentId: null }).parentId).toBeNull()
    })

    it('moves a subcategory among the subcategories of its category only', () => {
      const eltern = create(leitung, 'Eltern')
      const personal = create(leitung, 'Personal')
      sub(leitung, eltern, 'A')
      const b = sub(leitung, eltern, 'B')
      sub(leitung, personal, 'X')
      moveCategory(db, leitung, b, 'up')
      expect(tree('admin')).toEqual(['Eltern', '  B', '  A', 'Personal', '  X'])
      moveCategory(db, leitung, b, 'up')
      expect(tree('admin')).toEqual(['Eltern', '  B', '  A', 'Personal', '  X'])
      moveCategory(db, leitung, personal, 'up')
      expect(tree('admin')).toEqual(['Personal', '  X', 'Eltern', '  B', '  A'])
    })

    it('deletes a category only without subcategories and a subcategory only without templates', () => {
      const eltern = create(leitung, 'Eltern')
      const briefe = sub(leitung, eltern, 'Briefe')
      const leer = sub(leitung, eltern, 'Leer')
      const user = addUser(db, 'leitung', 'admin')
      uploadTemplate(db, { ...user, facilityId: 1 }, { title: 'Brief', categoryId: briefe, scope: 'facility' }, { data: pdf, filename: 'b.pdf' })
      expect(errorCode(() => deleteCategory(db, leitung, eltern))).toBe('template_category_has_subcategories')
      expect(errorCode(() => deleteCategory(db, leitung, briefe))).toBe('template_category_not_empty')
      deleteCategory(db, leitung, leer)
      expect(tree('admin')).toEqual(['Eltern', '  Briefe'])
      expect(listCategories(db, leitung).find(category => category.id === briefe)!.templateCount).toBe(1)
      expect(listCategories(db, leitung).find(category => category.id === eltern)!.templateCount).toBe(0)
    })

    it('keeps each facility\'s subcategories to itself', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(templateCategories).run()
      sub(leitung, create(leitung, 'Eltern'), 'Briefe')
      sub(as('admin', krippe), create(as('admin', krippe), 'Eltern'), 'Ausflüge')
      expect(tree('admin')).toEqual(['Eltern', '  Briefe'])
      expect(tree('admin', krippe)).toEqual(['Eltern', '  Ausflüge'])
    })

    it('counts the Träger\'s templates where they show: in the subcategory of their path, else directly in the category', () => {
      const eltern = create(leitung, 'Eltern')
      const briefe = sub(leitung, eltern, 'Briefe')
      const traeger = addUser(db, 'traeger', 'provider')
      const global = (title: string, subcategoryName?: string) => uploadTemplate(db, { ...traeger, facilityId: 1 },
        { title, categoryName: 'eltern', subcategoryName, scope: 'all' }, { data: pdf, filename: 'x.pdf' })
      global('In Briefe', 'BRIEFE')
      global('Unbekannt', 'Ausflüge')
      global('Direkt')
      const counts = Object.fromEntries(listCategories(db, leitung).map(category => [category.id, category.globalCount]))
      expect(counts).toEqual({ [eltern]: 2, [briefe]: 1 })
    })

    it('offers the Träger the subcategory names under each category name, from the facilities and the templates', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(templateCategories).run()
      sub(leitung, create(leitung, 'Eltern'), 'Briefe')
      sub(as('admin', krippe), create(as('admin', krippe), 'eltern'), 'Ausflüge')
      sub(as('admin', krippe), create(as('admin', krippe), 'Personal'), 'briefe')
      const traeger = addUser(db, 'traeger', 'provider')
      uploadTemplate(db, { ...traeger, facilityId: 1 }, { title: 'X', categoryName: 'Gesundheit', subcategoryName: 'Atteste', scope: 'all' },
        { data: pdf, filename: 'x.pdf' })
      expect(globalCategoryNames(db, provider)).toEqual([
        { name: 'Eltern', subcategories: ['Ausflüge', 'Briefe'] },
        { name: 'Gesundheit', subcategories: ['Atteste'] },
        { name: 'Personal', subcategories: ['briefe'] },
      ])
    })
  })
})
