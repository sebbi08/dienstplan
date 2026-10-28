import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { templateCategories } from '../../server/db/schema'
import { DEFAULT_TEMPLATE_CATEGORIES } from '../../server/db/seed'
import { uploadTemplate } from '../../server/services/printTemplates'
import {
  createCategory, deleteCategory, listCategories, moveCategory, updateCategory,
} from '../../server/services/templateCategories'
import type { TemplateVisibility } from '../../shared/domain/templateCategories'
import type { Role } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const pdf = Buffer.from('%PDF-1.7\ncontent')

describe('template categories', () => {
  let db: Db
  const provider = { role: 'provider' as Role }
  const leitung = { role: 'admin' as Role }
  const create = (by: { role: Role }, name: string, visibility: TemplateVisibility = 'all') =>
    createCategory(db, by, { name, visibility })
  const names = (role: Role) => listCategories(db, { role }).map(category => category.name)

  it('starts a new database with the default categories, visible to all', () => {
    expect(listCategories(createTestDb(), leitung).map(category => [category.name, category.visibility, category.templateCount]))
      .toEqual(DEFAULT_TEMPLATE_CATEGORIES.map(name => [name, 'all', 0]))
    expect(DEFAULT_TEMPLATE_CATEGORIES).toEqual(['Eltern', 'Gesundheit', 'Personal'])
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
        { id: eltern, name: 'Eltern', visibility: 'all', templateCount: 0 },
        { id: expect.any(Number), name: 'Personal', visibility: 'managers', templateCount: 0 },
      ])
    })

    it('needs a name and keeps names unique regardless of case, umlauts and ß/ss included', () => {
      expect(errorCode(() => create(leitung, '   '))).toBe('template_category_name_required')
      create(leitung, 'Eltern')
      expect(errorCode(() => create(leitung, 'eltern'))).toBe('template_category_name_taken')
      expect(errorCode(() => create(provider, ' ELTERN '))).toBe('template_category_name_taken')
      create(leitung, 'Ärztliches')
      expect(errorCode(() => create(leitung, 'ärztliches'))).toBe('template_category_name_taken')
      create(leitung, 'Straße')
      expect(errorCode(() => create(leitung, 'STRASSE'))).toBe('template_category_name_taken')
      expect(names('provider')).toEqual(['Eltern', 'Ärztliches', 'Straße'])
    })

    it('lets a category keep its own name, also beside a case twin from before the categories', () => {
      const id = create(leitung, 'Übungen')
      // A twin the free-text categories could leave behind (the database index folds ASCII letters only).
      const twin = db.insert(templateCategories).values({ name: 'übungen', sortOrder: 9 }).returning().get().id
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

    it('marks a category holding templates (of any facility) as in use', () => {
      const used = create(leitung, 'Eltern')
      create(leitung, 'Leer')
      const other = addFacility(db, 'Krippe')
      const otherLeitung = addUser(db, 'leitung2', 'admin', null, other)
      uploadTemplate(db, { id: otherLeitung.id, role: 'admin', facilityId: other },
        { title: 'Brief', categoryId: used, scope: 'facility' }, { data: pdf, filename: 'brief.pdf' })
      expect(listCategories(db, leitung).map(category => [category.name, category.templateCount])).toEqual([['Eltern', 1], ['Leer', 0]])
    })

    it('lets only the Träger create a category for the Träger alone', () => {
      expect(errorCode(() => create(leitung, 'Geheim', 'provider'))).toBe('forbidden')
      create(leitung, 'Leitung', 'managers')
      create(provider, 'Geheim', 'provider')
      expect(names('provider')).toEqual(['Leitung', 'Geheim'])
    })

    it('refuses Mitarbeiter and the tablet', () => {
      expect(errorCode(() => create({ role: 'observer' }, 'X'))).toBe('forbidden')
      expect(errorCode(() => create({ role: 'terminal' }, 'X'))).toBe('forbidden')
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
  })

  describe('delete', () => {
    it('deletes an empty category only', () => {
      const used = create(leitung, 'Eltern')
      const empty = create(leitung, 'Leer')
      const user = addUser(db, 'leitung', 'admin')
      uploadTemplate(db, { id: user.id, role: 'admin', facilityId: 1 }, { title: 'Brief', categoryId: used, scope: 'facility' },
        { data: pdf, filename: 'brief.pdf' })
      expect(errorCode(() => deleteCategory(db, leitung, used))).toBe('template_category_not_empty')
      deleteCategory(db, leitung, empty)
      expect(names('admin')).toEqual(['Eltern'])
      expect(errorCode(() => deleteCategory(db, leitung, empty))).toBe('template_category_not_found')
    })
  })
})
