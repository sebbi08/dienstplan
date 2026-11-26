import { describe, expect, it } from 'vitest'
import {
  berlinDay, categoryOfNames, defaultGlobalVisibility, hiddenByVisibility, movedToProvider,
  readTemplateTabMemory, sameCategoryName, templatePath, titleFromFileName, writeTemplateTabMemory,
} from '../../app/utils/printTemplates'
import type { TemplateVisibility } from '../../shared/domain/templateCategories'
import type { TemplateCategoryDto } from '../../shared/types/api'

const category = (id: number, name: string, visibility: TemplateVisibility = 'all', templateCount = 2, globalCount = 0): TemplateCategoryDto =>
  ({ id, parentId: null, name, visibility, templateCount, formCount: 0, globalCount, hiddenSubcategories: 0 })

// (The sub-tabs of „Vorlagen“ are tested in tests/domain/templateEntries.test.ts.)
describe('print template page helpers', () => {
  it('remembers the sub-tab per device, and does without storage', () => {
    // No localStorage here (node): nothing remembered, nothing thrown.
    expect(readTemplateTabMemory()).toBeNull()
    expect(() => writeTemplateTabMemory('category-1')).not.toThrow()
    const store = new Map<string, string>()
    globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } as Storage
    try {
      writeTemplateTabMemory('category-7')
      expect(readTemplateTabMemory()).toBe('category-7')
    }
    finally {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
  })

  it('counts the templates hidden from Leitung, Mitarbeiter and tablet when a category becomes the Träger\'s alone', () => {
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 3), 'provider').count).toBe(3)
    expect(hiddenByVisibility(category(1, 'Eltern', 'managers', 2), 'provider').count).toBe(2)
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 0), 'provider').count).toBe(0)
    expect(hiddenByVisibility(category(1, 'Eltern', 'provider', 3), 'provider').count).toBe(0)
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 3), 'managers').count).toBe(0)
    // The Träger's templates shown in it by name count too (the confirmation names them).
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 1, 2), 'provider').count).toBe(3)
  })

  it('names the Träger\'s templates that move to „Vom Träger“ when the category is deleted or renamed', () => {
    const personal = category(1, 'Personal', 'managers', 0, 2)
    expect(movedToProvider(personal, null)).toBe(2)
    expect(movedToProvider(personal, 'Personalakten')).toBe(2)
    // The same name in other letters keeps them.
    expect(movedToProvider(personal, ' PERSONAL ')).toBe(0)
    expect(movedToProvider(category(2, 'Straße', 'all', 0, 1), 'STRASSE')).toBe(0)
    expect(movedToProvider(category(3, 'Eltern', 'all', 4, 0), null)).toBe(0)
    expect(sameCategoryName('Ärztliches', 'ÄRZTLICHES')).toBe(true)
    expect(sameCategoryName('Eltern', 'Elternbriefe')).toBe(false)
  })

  it('starts a template for all facilities as restricted as the category it is filed under', () => {
    const all = ['all', 'managers', 'provider'] as const
    expect(defaultGlobalVisibility(category(1, 'Leitung intern', 'managers'), all)).toBe('managers')
    expect(defaultGlobalVisibility(category(1, 'Geheim', 'provider'), all)).toBe('provider')
    expect(defaultGlobalVisibility(category(1, 'Eltern'), all)).toBe('all')
    // „Vom Träger“ (no category) or none open: visible to all.
    expect(defaultGlobalVisibility(null, all)).toBe('all')
    expect(defaultGlobalVisibility(undefined, all)).toBe('all')
    // Never wider than the editor may give, never wider than the category: the strictest level the editor has.
    expect(defaultGlobalVisibility(category(1, 'Geheim', 'provider'), ['all', 'managers'])).toBe('managers')
  })

  it('shows the Berlin day of a timestamp', () => {
    expect(berlinDay('2026-10-20T22:30:00.000Z')).toBe('2026-10-21')
    expect(berlinDay('2026-12-31T12:00:00.000Z')).toBe('2026-12-31')
  })

  it('takes the file name without extension as title', () => {
    expect(titleFromFileName('Einverständnis Ausflug.pdf')).toBe('Einverständnis Ausflug')
    expect(titleFromFileName('Brief.v2.PDF')).toBe('Brief.v2')
    expect(titleFromFileName('ohne')).toBe('ohne')
  })

  describe('subcategories', () => {
    const sub = (id: number, parentId: number, name: string, visibility: TemplateVisibility = 'all', templateCount = 0, globalCount = 0): TemplateCategoryDto =>
      ({ id, parentId, name, visibility, templateCount, formCount: 0, globalCount, hiddenSubcategories: 0 })

    it('names where a template of the Träger shows under „Vom Träger“', () => {
      expect(templatePath({ category: 'Küche', subcategory: 'Pläne' })).toBe('Küche › Pläne')
      expect(templatePath({ category: 'Küche', subcategory: '' })).toBe('Küche')
    })

    it('counts a category\'s subcategories too when it becomes the Träger\'s alone, or is renamed', () => {
      const categories = [category(1, 'Eltern', 'all', 1, 1), sub(11, 1, 'Briefe', 'all', 2, 3), sub(12, 1, 'Leer'), category(2, 'Personal', 'all', 5)]
      expect(hiddenByVisibility(categories[0]!, 'provider', categories)).toEqual({ count: 7, global: 4 })
      // The Bögen in it are hidden as well (the visibility applies to both kinds).
      expect(hiddenByVisibility({ ...categories[0]!, formCount: 2 }, 'provider', categories)).toEqual({ count: 9, global: 4 })
      expect(hiddenByVisibility(categories[1]!, 'provider', categories)).toEqual({ count: 5, global: 3 })
      expect(movedToProvider(categories[0]!, 'Elternbriefe', categories)).toBe(4)
      // A subcategory's own: they move into its category.
      expect(movedToProvider(categories[1]!, null, categories)).toBe(3)
      expect(movedToProvider(categories[1]!, 'BRIEFE', categories)).toBe(0)
    })

    it('starts a template for all facilities with the stricter of category and subcategory, found by the typed names', () => {
      const all = ['all', 'managers', 'provider'] as const
      const intern = category(1, 'Intern', 'managers')
      const offen = sub(11, 1, 'Offen', 'all')
      const eltern = category(2, 'Eltern', 'all')
      const leitung = sub(21, 2, 'Leitung', 'managers')
      expect(defaultGlobalVisibility(intern, all, offen)).toBe('managers')
      expect(defaultGlobalVisibility(eltern, all, leitung)).toBe('managers')
      expect(defaultGlobalVisibility(eltern, all, null)).toBe('all')
      expect(defaultGlobalVisibility(eltern, ['all'], leitung)).toBe('all')
      const categories = [intern, offen, eltern, leitung]
      expect(categoryOfNames(categories, ' eltern ', 'LEITUNG')).toEqual({ category: eltern, subcategory: leitung })
      expect(categoryOfNames(categories, 'Eltern', 'Offen')).toEqual({ category: eltern, subcategory: undefined })
      expect(categoryOfNames(categories, 'Leitung', '')).toEqual({ category: undefined, subcategory: undefined })
    })
  })
})
