import { describe, expect, it } from 'vitest'
import {
  berlinDay, chosenTemplateTab, defaultGlobalVisibility, FROM_PROVIDER_TAB, hiddenByVisibility, movedToProvider,
  readTemplateTabMemory, sameCategoryName, templateTabs, titleFromFileName, writeTemplateTabMemory,
} from '../../app/utils/printTemplates'
import type { TemplateVisibility } from '../../shared/domain/templateCategories'
import type { PrintTemplateDto, TemplateCategoryDto } from '../../shared/types/api'

const template = (id: number, categoryId: number | null, title: string, category = ''): PrintTemplateDto => ({
  id, title, categoryId, category, global: categoryId === null, globalCategoryName: categoryId === null ? category : null,
  globalVisibility: categoryId === null ? 'all' : null, size: 1, uploadedAt: '', updatedAt: '', canEdit: true,
})
const category = (id: number, name: string, visibility: TemplateVisibility = 'all', templateCount = 2, globalCount = 0): TemplateCategoryDto =>
  ({ id, name, visibility, templateCount, globalCount })

describe('print template page helpers', () => {
  it('makes a sub-tab of every category the viewer sees, in the facility\'s order, empty ones too, templates in the server\'s order', () => {
    const tabs = templateTabs([category(3, 'Sonstiges'), category(1, 'Eltern'), category(2, 'Leer')], [
      template(1, 3, 'Zettel'), template(2, 1, 'Übernachtung'), template(3, 1, 'Ausflug'), template(4, 3, 'Attest'),
      // A category the viewer does not see (not in the list) shows nothing.
      template(5, 9, 'Versteckt'),
    ])
    expect(tabs.map(tab => [tab.key, tab.category?.name, tab.templates.map(t => t.title)])).toEqual([
      ['category-3', 'Sonstiges', ['Zettel', 'Attest']], ['category-1', 'Eltern', ['Übernachtung', 'Ausflug']], ['category-2', 'Leer', []],
    ])
  })

  it('adds „Vom Träger“ last, only when templates for all facilities fit no category of the facility', () => {
    expect(templateTabs([category(1, 'Eltern')], [template(1, 1, 'Brief')]).map(tab => tab.key)).toEqual(['category-1'])
    const tabs = templateTabs([category(1, 'Eltern')], [
      template(1, null, 'Urlaubsantrag', 'Personal'), template(2, null, 'Speiseplan', 'Küche'), template(3, null, 'Attest', 'Personal'),
    ])
    expect(tabs.map(tab => [tab.key, tab.category, tab.templates.map(t => t.title)])).toEqual([
      ['category-1', category(1, 'Eltern'), []], [FROM_PROVIDER_TAB, null, ['Urlaubsantrag', 'Speiseplan', 'Attest']],
    ])
  })

  it('opens the remembered sub-tab when it is there, else the first', () => {
    const tabs = templateTabs([category(1, 'Eltern'), category(2, 'Personal')], [])
    expect(chosenTemplateTab(tabs, 'category-2')).toBe('category-2')
    expect(chosenTemplateTab(tabs, 'category-9')).toBe('category-1')
    expect(chosenTemplateTab(tabs, null)).toBe('category-1')
    expect(chosenTemplateTab([], 'category-1')).toBeNull()
  })

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
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 3), 'provider')).toBe(3)
    expect(hiddenByVisibility(category(1, 'Eltern', 'managers', 2), 'provider')).toBe(2)
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 0), 'provider')).toBe(0)
    expect(hiddenByVisibility(category(1, 'Eltern', 'provider', 3), 'provider')).toBe(0)
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 3), 'managers')).toBe(0)
    // The Träger's templates shown in it by name count too (the confirmation names them).
    expect(hiddenByVisibility(category(1, 'Eltern', 'all', 1, 2), 'provider')).toBe(3)
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
})
