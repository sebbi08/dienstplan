import { describe, expect, it } from 'vitest'
import {
  chosenLibraryTab, FROM_PROVIDER_TAB, libraryGroups, librarySearch, libraryTabs, movedEntries, NO_CATEGORY_TAB, type LibraryEntry,
} from '../../app/utils/templateEntries'
import { compareEntryPlaces, MERGED_BOGEN_PLACE, mergeEntries } from '../../shared/domain/templateEntries'
import type { FormTemplateDto, PrintTemplateDto, TemplateCategoryDto } from '../../shared/types/api'

const category = (id: number, name: string, parentId: number | null = null): TemplateCategoryDto =>
  ({ id, parentId, name, visibility: 'all', templateCount: 0, formCount: 0, globalCount: 0, hiddenSubcategories: 0 })
const pdf = (id: number, title: string, categoryId: number | null, place: number | null, subcategoryId: number | null = null): PrintTemplateDto => ({
  id, title, categoryId, category: '', subcategoryId, subcategory: '', global: categoryId === null, globalCategoryName: null,
  globalSubcategoryName: null, globalVisibility: null, allFacilities: false, visibility: 'all', size: 1, uploadedAt: '', updatedAt: '',
  canEdit: true, fillable: false, place, targets: null,
})
const bogen = (id: number, name: string, categoryId: number | null, sortOrder: number, extra: Partial<FormTemplateDto> = {}): FormTemplateDto => ({
  id, kind: 'child', subject: null, printLayout: null, name, starterKey: null, selfAssessment: false, archived: false, sortOrder,
  content: { sections: [] }, updatedAt: '', updatedBy: '', inUse: false, categoryId, subcategoryId: null, category: null, ...extra,
})
const titles = (entries: readonly LibraryEntry[]) => entries.map(entry => entry.title)

describe('one order for Bögen and PDF templates', () => {
  it('puts the placed entries first by place (the PDF at a tie), then the PDFs of before, then the Bögen moved up by 0133', () => {
    const p = (place: number | null) => ({ type: 'pdf' as const, id: 1, place })
    const f = (place: number) => ({ type: 'form' as const, id: 1, place })
    expect(compareEntryPlaces(p(0), f(1))).toBeLessThan(0)
    expect(compareEntryPlaces(f(0), p(1))).toBeLessThan(0)
    expect(compareEntryPlaces(p(2), f(2))).toBeLessThan(0)
    expect(compareEntryPlaces(p(null), f(MERGED_BOGEN_PLACE))).toBeLessThan(0)
    expect(compareEntryPlaces(f(5), p(null))).toBeLessThan(0)
    // Merged, each kind keeps its own order.
    const merged = mergeEntries([p(0), { ...p(null), id: 2 }, { ...p(null), id: 3 }], [f(MERGED_BOGEN_PLACE + 1), { ...f(MERGED_BOGEN_PLACE + 2), id: 2 }])
    expect(merged.map(entry => `${entry.type}-${entry.id}`)).toEqual(['pdf-1', 'pdf-2', 'pdf-3', 'form-1', 'form-2'])
  })
})

describe('the tabs of „Vorlagen“', () => {
  const categories = [category(1, 'Kinder'), category(11, 'Krippe', 1), category(2, 'Eltern')]

  it('shows both kinds in their categories, „Vom Träger“ and „Ohne Kategorie“ last, stopped Bögen apart', () => {
    const tabs = libraryTabs(categories, [pdf(1, 'Brief', 2, 1), pdf(2, 'Speiseplan', null, null), pdf(3, 'Attest', 1, 0)], [
      bogen(1, 'Beobachtung', 1, 1), bogen(2, 'Krippenbogen', 11, 0, { subcategoryId: 11, categoryId: 1 }), bogen(3, 'Alt', 1, 2, { archived: true }),
      bogen(4, 'Lose', null, 0),
    ])
    expect(tabs.map(tab => [tab.key, titles(tab.entries), titles(tab.archived)])).toEqual([
      ['category-1', ['Attest', 'Beobachtung', 'Krippenbogen'], ['Alt']],
      ['category-2', ['Brief'], []],
      [FROM_PROVIDER_TAB, ['Speiseplan'], []],
      [NO_CATEGORY_TAB, ['Lose'], []],
    ])
    const groups = libraryGroups(tabs[0]!)
    expect(groups.map(group => [group.groupId, titles(group.items)])).toEqual([[1, ['Attest', 'Beobachtung']], [11, ['Krippenbogen']]])
    expect(libraryGroups(tabs[2]!).map(group => group.groupId)).toEqual([null])
    expect(chosenLibraryTab(tabs, 'category-2')).toBe('category-2')
    expect(chosenLibraryTab(tabs, 'category-9')).toBe('category-1')
    expect(chosenLibraryTab([], null)).toBeNull()
  })

  it('finds both kinds in every tab, grouped by place, and moves an entry only among those one may move', () => {
    const tabs = libraryTabs(categories, [pdf(1, 'Brief Eltern', 1, 0), pdf(2, 'Brief Träger', null, null)], [
      bogen(1, 'Brief Kinder', 1, 1), bogen(2, 'Briefbogen alt', 1, 2, { archived: true }),
    ])
    const groups = librarySearch(tabs, entry => entry.title.startsWith('Brief'), { provider: 'Vom Träger', none: 'Ohne Kategorie' })
    expect(groups.map(group => [group.heading, titles(group.entries)])).toEqual([
      ['Kinder', ['Brief Eltern', 'Brief Kinder', 'Briefbogen alt']], ['Vom Träger', ['Brief Träger']],
    ])
    const items = libraryGroups(tabs[0]!)[0]!.items
    expect(movedEntries(items, () => true, 'form-1', -1)).toEqual([{ type: 'form', id: 1 }, { type: 'pdf', id: 1 }])
    expect(movedEntries(items, () => true, 'form-1', 1)).toBeNull()
    expect(movedEntries(items, entry => entry.type === 'form', 'form-1', -1)).toBeNull()
  })
})
