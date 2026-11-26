import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { formStarterSeeds, templateCategories } from '../../server/db/schema'
import { listChildForms } from '../../server/services/childForms'
import { createFacility } from '../../server/services/facilities'
import { exampleCategoryOf, seedFormCategories } from '../../server/services/formTemplateCategories'
import { copyTemplate, createTemplate, deleteTemplate, listTemplates, templateChoices, updateTemplate } from '../../server/services/formTemplates'
import { listEntries, orderEntries, uploadTemplate } from '../../server/services/printTemplates'
import { createCategory, deleteCategory, listCategories, updateCategory } from '../../server/services/templateCategories'
import type { SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addUser, asChildViewer, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

/**
 * The Bögen in the shared categories of „Vorlagen“ (template_categories, since 0133_one_template_library): the example
 * categories by name (a stricter twin gets „‹Name› (Bögen)“), filing a Bogen, „Wer sieht sie?“ for the Bögen (library,
 * pickers, making a form), deleting only an empty category (also no Bögen), one order across both kinds, facility
 * isolation.
 */

const now = new Date('2026-11-25T09:00:00.000Z')
const pdf = () => Buffer.from('%PDF-1.7\ncontent')
let db: Db
let leitung: SessionUser
let traeger: SessionUser
const tops = (facilityId = 1) => listCategories(db, { role: 'provider', facilityId }).filter(row => row.parentId === null).map(row => row.name)
const asEditor = (user: SessionUser, facilityId = 1) => ({ ...user, facilityId })

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Anna Leitung'))
  traeger = addUser(db, 'traeger', 'provider')
})

describe('Bögen in the categories of „Vorlagen“', () => {
  it('gives a new facility the example categories after the PDF ones, with the starters filed by kind, once', () => {
    const krippe = createFacility(db, 'Krippe').id
    expect(tops(krippe)).toEqual(['Eingewöhnungsmappe', 'Mitarbeitermappe', 'Eltern', 'Gesundheit', 'Personal',
      'Kinder', 'Fachkräfte', 'Team', 'Unfälle', 'Infogespräche', 'Hospitationen'])
    // The new facility's accident starters sit in „Unfälle“.
    expect(listTemplates(db, krippe).map(template => template.category)).toEqual(['Unfälle', 'Unfälle'])
    // A deleted example does not come back.
    deleteCategory(db, asEditor(traeger, krippe), exampleCategoryOf(db, krippe, 'info')!)
    seedFormCategories(db, krippe, now)
    expect(tops(krippe)).not.toContain('Infogespräche')
  })

  it('files the starters of a stricter twin in „‹Name› (Bögen)“, so they stay offered to everyone', () => {
    const facility = createFacility(db, 'Hort').id
    // As if the facility had a category „Unfälle“ only for Leitung and Träger before the examples arrived.
    db.delete(formStarterSeeds).where(eq(formStarterSeeds.facilityId, facility)).run()
    db.delete(templateCategories).where(eq(templateCategories.facilityId, facility)).run()
    createCategory(db, asEditor(traeger, facility), { name: 'Unfälle', visibility: 'managers' })
    seedFormCategories(db, facility, now)
    expect(tops(facility)).toEqual(['Unfälle', 'Kinder', 'Fachkräfte', 'Team', 'Unfälle (Bögen)', 'Infogespräche', 'Hospitationen'])
    const bogen = exampleCategoryOf(db, facility, 'accident')!
    expect(listCategories(db, { role: 'provider', facilityId: facility }).find(row => row.id === bogen)).toMatchObject({ name: 'Unfälle (Bögen)', visibility: 'all' })
  })

  it('shows a Bogen only to those who see its category: library, pickers and making a form', () => {
    const intern = createCategory(db, asEditor(leitung), { name: 'Intern', visibility: 'managers' })
    const geheim = createCategory(db, asEditor(traeger), { name: 'Geheim', visibility: 'provider' })
    const make = (name: string, categoryId: number | null) =>
      createTemplate(db, traeger, 1, { kind: 'child', name, selfAssessment: false, categoryId }, now)
    const offen = make('Offen', null)
    const fuerLeitung = make('Für Leitung', intern)
    const nurTraeger = make('Nur Träger', geheim)
    const ids = (role: 'provider' | 'admin' | 'observer') => templateChoices(db, 1, 'child', { role }).map(choice => choice.id)
    expect(ids('provider')).toEqual(expect.arrayContaining([offen, fuerLeitung, nurTraeger]))
    expect(ids('admin')).toEqual(expect.arrayContaining([offen, fuerLeitung]))
    expect(ids('admin')).not.toContain(nurTraeger)
    expect(ids('observer')).toContain(offen)
    expect(ids('observer')).not.toContain(fuerLeitung)
    // The library of the Leitung leaves out the Träger's, and the Leitung can neither change nor delete it.
    expect(listTemplates(db, 1, undefined, leitung).map(template => template.id)).not.toContain(nurTraeger)
    expect(errorCode(() => updateTemplate(db, leitung, 1, nurTraeger, { name: 'X' }, now))).toBe('form_template_not_found')
    expect(errorCode(() => deleteTemplate(db, 1, nurTraeger, leitung))).toBe('form_template_not_found')
    expect(errorCode(() => copyTemplate(db, leitung, 1, nurTraeger, now))).toBe('form_template_not_found')
    expect(errorCode(() => createTemplate(db, leitung, 1, { kind: 'team', name: 'Y', selfAssessment: false, categoryId: geheim }, now)))
      .toBe('form_category_invalid')
    // The child record's picker of a Mitarbeiter at the tablet (the person's role) offers the open ones only.
    const child = addChild(db, 1)
    const staff = addUser(db, 'kollegin', 'observer', addEmployee(db, 'Kim Kollegin'), 1)
    const viewer = { ...asChildViewer(leitung), role: staff.role, permissions: permissionsOf('admin') }
    const offered = listChildForms(db, viewer, child, now).templates.map(template => template.id)
    expect(offered).toContain(offen)
    expect(offered).not.toContain(fuerLeitung)
  })

  it('deletes only a category without PDF templates and Bögen (also stopped ones)', () => {
    const editor = asEditor(leitung)
    const kinder = exampleCategoryOf(db, 1, 'child')!
    const sub = createCategory(db, editor, { name: 'Krippe', visibility: 'all', parentId: kinder })
    const template = createTemplate(db, leitung, 1, { kind: 'child', name: 'Eingewöhnung', selfAssessment: false, categoryId: sub }, now)
    updateTemplate(db, leitung, 1, template, { archived: true }, now)
    expect(errorCode(() => deleteCategory(db, editor, sub))).toBe('template_category_not_empty')
    expect(listCategories(db, { ...editor, permissions: leitung.permissions }).find(row => row.id === sub)).toMatchObject({ formCount: 1, templateCount: 0 })
    // Without formTemplates.manage the Bögen are not counted.
    expect(listCategories(db, { role: 'observer', facilityId: 1, permissions: permissionsOf('observer') }).find(row => row.id === sub)!.formCount).toBe(0)
    updateTemplate(db, leitung, 1, template, { categoryId: kinder }, now)
    deleteCategory(db, editor, sub)
  })

  it('orders PDF templates and Bögen of a list together; a new entry of either kind goes to the end', () => {
    const editor = asEditor(leitung)
    const eltern = createCategory(db, editor, { name: 'Briefe', visibility: 'all' })
    const upload = (title: string) => uploadTemplate(db, editor, { title, scope: 'facility', categoryId: eltern }, { data: pdf(), filename: `${title}.pdf` }, now)
    const bogen = (name: string) => createTemplate(db, leitung, 1, { kind: 'child', name, selfAssessment: false, categoryId: eltern }, now)
    const a = upload('PDF A')
    const b = bogen('Bogen B')
    const c = upload('PDF C')
    const keys = () => listEntries(db, 1, eltern).map(entry => `${entry.type}-${entry.id}`)
    expect(keys()).toEqual([`pdf-${a}`, `form-${b}`, `pdf-${c}`])
    orderEntries(db, editor, eltern, [{ type: 'pdf', id: c }, { type: 'pdf', id: a }, { type: 'form', id: b }])
    expect(keys()).toEqual([`pdf-${c}`, `pdf-${a}`, `form-${b}`])
    const d = bogen('Bogen D')
    expect(keys().at(-1)).toBe(`form-${d}`)
    // Without formTemplates.manage only the PDF templates move; the Bögen keep their places.
    const pdfOnly = { ...editor, permissions: new Set([...leitung.permissions].filter(key => key !== 'formTemplates.manage')) }
    expect(errorCode(() => orderEntries(db, pdfOnly, eltern, [{ type: 'pdf', id: a }, { type: 'pdf', id: c }, { type: 'form', id: b }, { type: 'form', id: d }])))
      .toBe('invalid_order')
    orderEntries(db, pdfOnly, eltern, [{ type: 'pdf', id: a }, { type: 'pdf', id: c }])
    expect(keys()).toEqual([`pdf-${a}`, `pdf-${c}`, `form-${b}`, `form-${d}`])
    // An entry missing, twice or of another list is refused.
    for (const entries of [[{ type: 'pdf' as const, id: a }], [{ type: 'pdf' as const, id: a }, { type: 'pdf' as const, id: a }]]) {
      expect(errorCode(() => orderEntries(db, pdfOnly, eltern, entries))).toBe('invalid_order')
    }
  })

  it('keeps every facility to its own categories', () => {
    const krippe = createFacility(db, 'Krippe').id
    const foreign = exampleCategoryOf(db, krippe, 'team')!
    expect(errorCode(() => createTemplate(db, leitung, 1, { kind: 'team', name: 'X', selfAssessment: false, categoryId: foreign }, now)))
      .toBe('form_category_invalid')
    const own = createTemplate(db, leitung, 1, { kind: 'team', name: 'Y', selfAssessment: false }, now)
    expect(errorCode(() => updateTemplate(db, leitung, 1, own, { categoryId: foreign }, now))).toBe('form_category_invalid')
    expect(errorCode(() => orderEntries(db, asEditor(leitung), foreign, [{ type: 'form', id: own }]))).toBe('template_category_not_found')
  })

  it('lists the pickers by category › subcategory in the category order, still only the active ones of the kind', () => {
    const editor = asEditor(leitung)
    const kinder = exampleCategoryOf(db, 1, 'child')!
    const team = exampleCategoryOf(db, 1, 'team')!
    const krippe = createCategory(db, editor, { name: 'Krippe', visibility: 'all', parentId: kinder })
    const make = (name: string, kind: 'child' | 'team', categoryId: number | null) =>
      createTemplate(db, leitung, 1, { kind, name, selfAssessment: false, categoryId }, now)
    make('Spät', 'child', null)
    make('Eingewöhnung', 'child', krippe)
    make('Kind im Team', 'child', team)
    make('Sitzung', 'team', team)
    const stopped = make('Alt', 'child', kinder)
    updateTemplate(db, leitung, 1, stopped, { archived: true }, now)
    // The pickers follow the categories' order (renaming changes nothing there).
    updateCategory(db, editor, team, { name: 'Team', visibility: 'all' })
    const order = listCategories(db, editor).filter(row => row.parentId === null).map(row => row.id)
    expect(order.indexOf(kinder)).toBeLessThan(order.indexOf(team))
    const choices = templateChoices(db, 1, 'child', leitung)
    expect(choices.map(choice => choice.category)).toEqual(['Kinder', 'Kinder › Krippe', 'Team', null])
    expect(choices.some(choice => choice.id === stopped)).toBe(false)
    const child = addChild(db, 1)
    expect(listChildForms(db, asChildViewer(leitung), child, now).templates.map(template => template.id))
      .toEqual(choices.map(choice => choice.id))
  })
})
