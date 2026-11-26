import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { formStarterSeeds, templateCategories } from '../../server/db/schema'
import { listChildForms } from '../../server/services/childForms'
import { createFacility } from '../../server/services/facilities'
import { exampleCategoryOf, seedFormCategories } from '../../server/services/formTemplateCategories'
import { copyTemplate, createTemplate, deleteTemplate, listTemplates, templateChoices, updateTemplate } from '../../server/services/formTemplates'
import { listEntries, orderEntries, uploadTemplate } from '../../server/services/printTemplates'
import { createCategory, deleteCategory, listCategories, moveCategory, updateCategory } from '../../server/services/templateCategories'
import type { SessionUser } from '../../shared/types/api'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { addChild, addEmployee, addGroup, addUser, asChildViewer, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

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
      createTemplate(db, traeger, 1, { kind: 'child', name, selfAssessment: false, categoryId, confirmRestricted: true }, now)
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

  it('asks before Bögen vanish from those who fill them in: a stricter category, filing or moving a Bogen into one', () => {
    const editor = asEditor(leitung)
    const unfaelle = exampleCategoryOf(db, 1, 'accident')!
    const sub = createCategory(db, editor, { name: 'Intern', visibility: 'all', parentId: unfaelle })
    const inSub = createTemplate(db, leitung, 1, { kind: 'accident', subject: 'child', name: 'Unfall Krippe', selfAssessment: false, categoryId: sub }, now)
    // „Unfälle“ holds the accident starters: „nur Leitung und Träger“ hides them (and the subcategory's) from the staff.
    expect(errorCode(() => updateCategory(db, editor, unfaelle, { name: 'Unfälle', visibility: 'managers' }))).toBe('template_category_hides_forms')
    expect(errorCode(() => updateCategory(db, editor, sub, { name: 'Intern', visibility: 'managers' }))).toBe('template_category_hides_forms')
    // Renaming alone asks nothing; a confirmed change goes through, and widening it again asks nothing either.
    updateCategory(db, editor, unfaelle, { name: 'Unfallberichte', visibility: 'all' })
    updateCategory(db, editor, sub, { name: 'Intern', visibility: 'managers', confirmHidingForms: true })
    expect(templateChoices(db, 1, 'accident', { role: 'observer' }).map(choice => choice.id)).not.toContain(inSub)
    updateCategory(db, editor, sub, { name: 'Intern', visibility: 'all' })
    // A category without Bögen: no question.
    const leer = createCategory(db, editor, { name: 'Leer', visibility: 'all' })
    updateCategory(db, editor, leer, { name: 'Leer', visibility: 'managers' })
    // Filing a new Bogen into a stricter category, or moving one there, asks as well; within the same visibility not.
    const bogen = (categoryId: number | null, confirmRestricted?: boolean) =>
      createTemplate(db, leitung, 1, { kind: 'child', name: `Bogen ${categoryId}-${confirmRestricted}`, selfAssessment: false, categoryId, confirmRestricted }, now)
    expect(errorCode(() => bogen(leer))).toBe('form_category_restricted')
    const loose = bogen(null)
    expect(errorCode(() => updateTemplate(db, leitung, 1, loose, { categoryId: leer }, now))).toBe('form_category_restricted')
    updateTemplate(db, leitung, 1, loose, { categoryId: leer, confirmRestricted: true }, now)
    const leer2 = createCategory(db, editor, { name: 'Leer 2', visibility: 'managers' })
    updateTemplate(db, leitung, 1, loose, { categoryId: leer2 }, now)
    updateTemplate(db, leitung, 1, loose, { categoryId: null }, now)
  })

  it('lets either kind\'s right maintain the categories, never what the account cannot change', () => {
    // A Mitarbeiter account that maintains the Bögen only, and a Leitung that maintains the PDF templates only.
    const formsOnly = { ...addUser(db, 'boegen', 'observer', addEmployee(db, 'Bea Bögen'), 1), facilityId: 1 }
    formsOnly.permissions = new Set(['formTemplates.manage', 'printTemplates.view'] as const)
    const pdfOnly = { ...leitung, facilityId: 1, permissions: new Set([...leitung.permissions].filter(key => key !== 'formTemplates.manage')) }
    const upload = (categoryId: number) => uploadTemplate(db, asEditor(leitung), { title: 'Brief', scope: 'facility', categoryId }, { data: pdf(), filename: 'b.pdf' }, now)
    for (const actor of [formsOnly, pdfOnly]) {
      // Create, rename, order and delete an empty one: either right.
      const id = createCategory(db, actor, { name: `Neu ${actor.role}`, visibility: 'all' })
      updateCategory(db, actor, id, { name: `Umbenannt ${actor.role}`, visibility: 'all' })
      moveCategory(db, actor, id, 'up')
      deleteCategory(db, actor, id)
    }
    // A category with Bögen: the PDF-only account renames it, but neither restricts nor moves it.
    const kinder = exampleCategoryOf(db, 1, 'child')!
    createTemplate(db, leitung, 1, { kind: 'child', name: 'Beobachtung neu', selfAssessment: false, categoryId: kinder }, now)
    updateCategory(db, pdfOnly, kinder, { name: 'Kinder', visibility: 'all' })
    expect(errorCode(() => updateCategory(db, pdfOnly, kinder, { name: 'Kinder', visibility: 'managers', confirmHidingForms: true }))).toBe('template_category_other_kind')
    expect(errorCode(() => moveCategory(db, pdfOnly, kinder, 'up'))).toBe('template_category_other_kind')
    // A category with a PDF template: likewise for the Bögen-only account (which as Mitarbeiter sees „Alle“ only anyway).
    const briefe = createCategory(db, asEditor(leitung), { name: 'Briefe', visibility: 'all' })
    upload(briefe)
    expect(errorCode(() => moveCategory(db, formsOnly, briefe, 'up'))).toBe('template_category_other_kind')
    const formsLeitung = { ...leitung, facilityId: 1, permissions: new Set(['formTemplates.manage', 'printTemplates.view'] as const) }
    expect(errorCode(() => updateCategory(db, formsLeitung, briefe, { name: 'Briefe', visibility: 'managers' }))).toBe('template_category_other_kind')
    // The Bögen are counted for both.
    expect(listCategories(db, { ...pdfOnly }).find(row => row.id === kinder)!.formCount).toBeGreaterThan(0)
    expect(listCategories(db, { ...formsOnly }).find(row => row.id === kinder)!.formCount).toBeGreaterThan(0)
    // Without either right: no category work at all.
    const neither = { ...formsOnly, permissions: new Set(['printTemplates.view'] as const) }
    expect(errorCode(() => createCategory(db, neither, { name: 'X', visibility: 'all' }))).toBe('forbidden')
  })

  it('offers the person who unlocked the tablet only the Bögen of categories everyone sees', () => {
    const baeren = addGroup(db, 1, 'Bären')
    const kim = addEmployee(db, 'Kim', { groupId: baeren })
    setPin(db, 1, kim, '123456')
    const tablet = addUser(db, 'tablet', 'terminal')
    const child = addChild(db, 1, { groupId: baeren })
    const intern = createCategory(db, asEditor(leitung), { name: 'Intern', visibility: 'managers' })
    const kinder = exampleCategoryOf(db, 1, 'child')!
    const open = createTemplate(db, leitung, 1, { kind: 'child', name: 'Für alle', selfAssessment: false, categoryId: kinder }, now)
    const restricted = createTemplate(db, leitung, 1, { kind: 'child', name: 'Nur Leitung', selfAssessment: false, categoryId: intern, confirmRestricted: true }, now)
    const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, kim, '123456', now).token
    const viewer = resolveChildViewer(db, tablet, token, now)
    const offered = listChildForms(db, viewer, child, now).templates.map(template => template.id)
    expect(offered).toContain(open)
    expect(offered).not.toContain(restricted)
  })
})
