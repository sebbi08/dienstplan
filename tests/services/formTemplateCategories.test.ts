import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { formTemplateCategories } from '../../server/db/schema'
import { listChildForms } from '../../server/services/childForms'
import { createFacility } from '../../server/services/facilities'
import {
  createFormCategory, deleteFormCategory, exampleCategoryOf, listFormCategories, moveFormCategory, renameFormCategory, seedFormCategories,
} from '../../server/services/formTemplateCategories'
import { createTemplate, listTemplates, orderTemplates, templateChoices, updateTemplate } from '../../server/services/formTemplates'
import type { SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

/**
 * Own categories of the form templates (Dokumente → Bögen): the examples, creating, renaming, ordering and deleting
 * (only empty ones, no subcategories), one level of subcategories, filing a template, the order within a category, the
 * pickers grouped by category and still filtered by kind, facility isolation.
 */

const now = new Date('2026-11-25T09:00:00.000Z')
let db: Db
let leitung: SessionUser
const names = (facilityId = 1) => listFormCategories(db, facilityId).map(row => (row.parentId === null ? row.name : `  ${row.name}`))

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Anna Leitung'))
})

describe('form template categories', () => {
  it('gives every facility the example categories with the starters filed by kind, once', () => {
    expect(names()).toEqual(['Kinder', 'Fachkräfte', 'Team', 'Unfälle', 'Infogespräche', 'Hospitationen'])
    const krippe = createFacility(db, 'Krippe').id
    expect(names(krippe)).toEqual(['Kinder', 'Fachkräfte', 'Team', 'Unfälle', 'Infogespräche', 'Hospitationen'])
    // The new facility's accident starters sit in „Unfälle“.
    expect(listTemplates(db, krippe).map(template => template.category)).toEqual(['Unfälle', 'Unfälle'])
    // A deleted example does not come back.
    deleteFormCategory(db, krippe, exampleCategoryOf(db, krippe, 'info')!)
    seedFormCategories(db, krippe, now)
    expect(names(krippe)).not.toContain('Infogespräche')
  })

  it('creates, renames and orders categories and one level of subcategories; names unique among siblings', () => {
    const kinder = exampleCategoryOf(db, 1, 'child')!
    const krippe = createFormCategory(db, 1, { name: ' Krippe ', parentId: kinder })
    createFormCategory(db, 1, { name: 'Kita', parentId: kinder })
    expect(names()).toEqual(['Kinder', '  Krippe', '  Kita', 'Fachkräfte', 'Team', 'Unfälle', 'Infogespräche', 'Hospitationen'])
    expect(errorCode(() => createFormCategory(db, 1, { name: 'kinder' }))).toBe('form_category_name_taken')
    expect(errorCode(() => createFormCategory(db, 1, { name: 'KITA', parentId: kinder }))).toBe('form_category_name_taken')
    // The same name under another category or at the top is fine.
    createFormCategory(db, 1, { name: 'Krippe' })
    expect(errorCode(() => createFormCategory(db, 1, { name: 'Tief', parentId: krippe }))).toBe('form_category_parent_invalid')
    expect(errorCode(() => createFormCategory(db, 1, { name: '   ' }))).toBe('form_category_name_required')
    expect(errorCode(() => createFormCategory(db, 1, { name: 'x'.repeat(61) }))).toBe('form_category_name_too_long')
    renameFormCategory(db, 1, krippe, { name: 'Krippe (0–3)' })
    moveFormCategory(db, 1, krippe, 'down')
    moveFormCategory(db, 1, exampleCategoryOf(db, 1, 'team')!, 'up')
    expect(names().slice(0, 5)).toEqual(['Kinder', '  Kita', '  Krippe (0–3)', 'Team', 'Fachkräfte'])
    // At an end nothing changes.
    moveFormCategory(db, 1, kinder, 'up')
    expect(names()[0]).toBe('Kinder')
  })

  it('deletes only an empty category without subcategories', () => {
    const kinder = exampleCategoryOf(db, 1, 'child')!
    const sub = createFormCategory(db, 1, { name: 'Krippe', parentId: kinder })
    expect(errorCode(() => deleteFormCategory(db, 1, kinder))).toBe('form_category_has_subcategories')
    const template = createTemplate(db, leitung, 1, { kind: 'child', name: 'Eingewöhnung', selfAssessment: false, categoryId: sub }, now)
    updateTemplate(db, leitung, 1, template, { archived: true }, now)
    expect(errorCode(() => deleteFormCategory(db, 1, sub))).toBe('form_category_not_empty')
    updateTemplate(db, leitung, 1, template, { categoryId: kinder }, now)
    deleteFormCategory(db, 1, sub)
    expect(listFormCategories(db, 1).find(row => row.id === kinder)!.templateCount).toBeGreaterThanOrEqual(1)
  })

  it('keeps every facility to its own categories', () => {
    const krippe = createFacility(db, 'Krippe').id
    const foreign = exampleCategoryOf(db, krippe, 'team')!
    expect(errorCode(() => renameFormCategory(db, 1, foreign, { name: 'X' }))).toBe('form_category_not_found')
    expect(errorCode(() => moveFormCategory(db, 1, foreign, 'up'))).toBe('form_category_not_found')
    expect(errorCode(() => deleteFormCategory(db, 1, foreign))).toBe('form_category_not_found')
    expect(errorCode(() => createFormCategory(db, 1, { name: 'Sub', parentId: foreign }))).toBe('form_category_parent_invalid')
    expect(errorCode(() => createTemplate(db, leitung, 1, { kind: 'team', name: 'X', selfAssessment: false, categoryId: foreign }, now)))
      .toBe('form_category_invalid')
    const own = createTemplate(db, leitung, 1, { kind: 'team', name: 'Y', selfAssessment: false }, now)
    expect(errorCode(() => updateTemplate(db, leitung, 1, own, { categoryId: foreign }, now))).toBe('form_category_invalid')
    expect(db.select().from(formTemplateCategories).where(eq(formTemplateCategories.facilityId, krippe)).all()).toHaveLength(6)
  })

  it('lists the pickers by category › subcategory in the category order, still only the active ones of the kind', () => {
    const kinder = exampleCategoryOf(db, 1, 'child')!
    const team = exampleCategoryOf(db, 1, 'team')!
    const krippe = createFormCategory(db, 1, { name: 'Krippe', parentId: kinder })
    const make = (name: string, kind: 'child' | 'team', categoryId: number | null) =>
      createTemplate(db, leitung, 1, { kind, name, selfAssessment: false, categoryId }, now)
    const late = make('Spät', 'child', null)
    const sub = make('Eingewöhnung', 'child', krippe)
    const inTeam = make('Kind im Team', 'child', team)
    make('Sitzung', 'team', team)
    const stopped = make('Alt', 'child', kinder)
    updateTemplate(db, leitung, 1, stopped, { archived: true }, now)
    moveFormCategory(db, 1, team, 'up')
    moveFormCategory(db, 1, team, 'up')
    const choices = templateChoices(db, 1, 'child')
    expect(choices.map(choice => [choice.name, choice.category])).toEqual([
      ['Kind im Team', 'Team'], ['Entwicklungsgespräch', 'Kinder'], ['Eingewöhnung', 'Kinder › Krippe'], ['Spät', null],
    ].map(([name, category]) => [expect.stringContaining(name!), category]))
    expect(choices.some(choice => choice.id === stopped)).toBe(false)
    // The child record's picker gets the same list.
    const child = addChild(db, 1)
    expect(listChildForms(db, asChildViewer(leitung), child, now).templates.map(template => template.id))
      .toEqual(choices.map(choice => choice.id))
    expect([late, sub, inTeam].every(id => choices.some(choice => choice.id === id))).toBe(true)
    // A category's own list („Allgemein“) and its subcategory's are separate lists for ▲/▼.
    const own = make('Eigen', 'child', kinder)
    const kinderList = listTemplates(db, 1).filter(template => !template.archived && template.categoryId === kinder && template.subcategoryId === null)
      .map(template => template.id)
    expect(errorCode(() => orderTemplates(db, 1, kinder, [...kinderList, sub]))).toBe('invalid_order')
    expect(errorCode(() => orderTemplates(db, 1, krippe, [sub, own]))).toBe('invalid_order')
    orderTemplates(db, 1, kinder, [...kinderList].reverse())
    expect(listTemplates(db, 1).filter(template => !template.archived && template.categoryId === kinder && template.subcategoryId === null)
      .map(template => template.id)).toEqual([...kinderList].reverse())
  })

  it('answers a clash of the unique index (two requests at once) as 409 form_category_name_taken', () => {
    // As if another request had stored the name between the check and the write: the index refuses it.
    db.run(sql`CREATE TRIGGER clash BEFORE INSERT ON form_template_categories WHEN NEW.name = 'Doppelt'
      BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: form_template_categories.facility_id'); END`)
    expect(errorCode(() => createFormCategory(db, 1, { name: 'Doppelt' }))).toBe('form_category_name_taken')
  })
})
