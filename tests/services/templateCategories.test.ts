import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { templateCategories } from '../../server/db/schema'
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

  beforeEach(() => {
    db = createTestDb()
  })

  describe('create and list', () => {
    it('adds categories at the end, with the name trimmed, and lists them in their order', () => {
      const eltern = create(leitung, '  Eltern ')
      create(provider, 'Personal', 'managers')
      expect(listCategories(db, provider)).toEqual([
        { id: eltern, name: 'Eltern', visibility: 'all', inUse: false },
        { id: expect.any(Number), name: 'Personal', visibility: 'managers', inUse: false },
      ])
    })

    it('needs a name and keeps names unique regardless of case', () => {
      expect(errorCode(() => create(leitung, '   '))).toBe('template_category_name_required')
      create(leitung, 'Eltern')
      expect(errorCode(() => create(leitung, 'eltern'))).toBe('template_category_name_taken')
      expect(errorCode(() => create(provider, ' ELTERN '))).toBe('template_category_name_taken')
      create(leitung, 'Ärztliches')
      expect(errorCode(() => create(leitung, 'ärztliches'))).toBe('template_category_name_taken')
      expect(names('provider')).toEqual(['Eltern', 'Ärztliches'])
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
      expect(listCategories(db, leitung).map(category => [category.name, category.inUse])).toEqual([['Eltern', true], ['Leer', false]])
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
