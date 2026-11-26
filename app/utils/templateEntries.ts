import { stricterVisibility, TEMPLATE_VISIBILITIES, type TemplateVisibility } from '#shared/domain/templateCategories'
import { entryKey, mergeEntries } from '#shared/domain/templateEntries'
import type { FormTemplateDto, PrintTemplateDto, TemplateCategoryDto } from '#shared/types/api'
import { subcategoriesOf, subcategoryChip, topCategories, GENERAL_CHIP, type ItemGroup } from './subcategories'

/**
 * „Dokumente“ → „Vorlagen“: the Bögen (form templates, filled in the app) and the PDF templates (printed or filled as
 * PDF) side by side in the facility's categories. Each list – a category's own entries („Allgemein“) or a subcategory's –
 * shows both kinds in one order (shared/domain/templateEntries.ts); „Vom Träger“ holds only PDF templates of the Träger
 * without a category of their name here, „Ohne Kategorie“ only Bögen filed in none.
 */

/** One entry of the library: a PDF template or a Bogen, with where it is filed and its place in its list. */
export type LibraryEntry =
  | { type: 'pdf'; key: string; id: number; title: string; categoryId: number | null; subcategoryId: number | null; place: number | null; pdf: PrintTemplateDto; form?: undefined }
  | { type: 'form'; key: string; id: number; title: string; categoryId: number | null; subcategoryId: number | null; place: number; form: FormTemplateDto; pdf?: undefined }

export const pdfEntry = (pdf: PrintTemplateDto): LibraryEntry => ({
  type: 'pdf', key: entryKey({ type: 'pdf', id: pdf.id }), id: pdf.id, title: pdf.title, categoryId: pdf.categoryId,
  subcategoryId: pdf.subcategoryId, place: pdf.place, pdf,
})

export const formEntry = (form: FormTemplateDto): LibraryEntry => ({
  type: 'form', key: entryKey({ type: 'form', id: form.id }), id: form.id, title: form.name, categoryId: form.categoryId,
  subcategoryId: form.subcategoryId, place: form.sortOrder, form,
})

/** The keys of the tabs „Vom Träger“ and „Ohne Kategorie“ (a category's tab is `category-<id>`). */
export const FROM_PROVIDER_TAB = 'provider'
export const NO_CATEGORY_TAB = 'none'

/**
 * A tab of „Vorlagen“: a category of the facility (with its subcategories), „Vom Träger“ or „Ohne Kategorie“. `entries`
 * are the active ones (by list, each list in its order: the category's own first, then each subcategory's), `archived`
 * the stopped Bögen filed there.
 */
export interface LibraryTab {
  key: string
  kind: 'category' | 'provider' | 'none'
  category: TemplateCategoryDto | null
  subcategories: TemplateCategoryDto[]
  entries: LibraryEntry[]
  archived: LibraryEntry[]
}

const isArchived = (entry: LibraryEntry) => entry.type === 'form' && entry.form.archived

/** The entries of one list in its order: the PDF templates and the Bögen there (each in the server's order) merged. */
function listOf(pdfs: readonly LibraryEntry[], forms: readonly LibraryEntry[], subcategoryId: number | null): LibraryEntry[] {
  const inList = (entry: LibraryEntry) => entry.subcategoryId === subcategoryId
  return mergeEntries(pdfs.filter(inList), forms.filter(inList))
}

/**
 * The tabs: every category the viewer sees (the server lists only those; subcategories go with their category), in the
 * facility's order, also an empty one; then „Vom Träger“ when PDF templates of the Träger fit no category here, and
 * „Ohne Kategorie“ when Bögen lie in none. The PDF templates and Bögen as the server lists them (by category, each list
 * in its order).
 */
export function libraryTabs(
  categories: readonly TemplateCategoryDto[], pdfs: readonly PrintTemplateDto[], forms: readonly FormTemplateDto[],
): LibraryTab[] {
  const pdfEntries = pdfs.map(pdfEntry)
  const formEntries = forms.map(formEntry)
  const tabs: LibraryTab[] = topCategories(categories).map((category) => {
    const subcategories = subcategoriesOf(categories, category.id)
    const ownPdfs = pdfEntries.filter(entry => entry.categoryId === category.id)
    const ownForms = formEntries.filter(entry => entry.categoryId === category.id)
    const active = ownForms.filter(entry => !isArchived(entry))
    return {
      key: `category-${category.id}`, kind: 'category', category, subcategories,
      entries: [null, ...subcategories.map(sub => sub.id)].flatMap(subId => listOf(ownPdfs, active, subId)),
      archived: ownForms.filter(isArchived),
    }
  })
  const fromProvider = pdfEntries.filter(entry => entry.categoryId === null)
  if (fromProvider.length > 0) {
    tabs.push({ key: FROM_PROVIDER_TAB, kind: 'provider', category: null, subcategories: [], entries: fromProvider, archived: [] })
  }
  const loose = formEntries.filter(entry => entry.categoryId === null)
  if (loose.length > 0) {
    tabs.push({
      key: NO_CATEGORY_TAB, kind: 'none', category: null, subcategories: [],
      entries: loose.filter(entry => !isArchived(entry)), archived: loose.filter(isArchived),
    })
  }
  return tabs
}

/** The tab to open: the one asked for (or remembered) when it is there, else the first. */
export function chosenLibraryTab(tabs: readonly LibraryTab[], wanted: string | null): string | null {
  return tabs.find(tab => tab.key === wanted)?.key ?? tabs[0]?.key ?? null
}

/**
 * The lists of a tab (ItemGroup, as the small tabs of the subcategories use them): the entries directly in the category,
 * then one per subcategory; for „Vom Träger“ and „Ohne Kategorie“ the one list (`groupId` null). `groupId` is what the
 * order is sent with.
 */
export function libraryGroups(tab: LibraryTab): ItemGroup<TemplateCategoryDto, LibraryEntry>[] {
  if (!tab.category) return [{ key: GENERAL_CHIP, subcategory: null, groupId: null, items: tab.entries }]
  return [
    { key: GENERAL_CHIP, subcategory: null, groupId: tab.category.id, items: tab.entries.filter(entry => entry.subcategoryId === null) },
    ...tab.subcategories.map(subcategory => ({
      key: subcategoryChip(subcategory.id), subcategory, groupId: subcategory.id,
      items: tab.entries.filter(entry => entry.subcategoryId === subcategory.id),
    })),
  ]
}

/** A section of the search results: the matches in one place („Kategorie › Unterkategorie“, „Vom Träger“, „Ohne Kategorie“). */
export interface LibrarySearchGroup { key: string; heading: string; entries: LibraryEntry[] }

/**
 * The matches of every tab (stopped Bögen too), grouped by where they show, in the order of the tabs and lists.
 * `headings` names „Allgemein“-less places: the category's name, „Kategorie › Unterkategorie“, and the two special tabs.
 */
export function librarySearch(
  tabs: readonly LibraryTab[], matches: (entry: LibraryEntry) => boolean, headings: { provider: string; none: string },
): LibrarySearchGroup[] {
  const groups: LibrarySearchGroup[] = []
  for (const tab of tabs) {
    const all = [...tab.entries, ...tab.archived].filter(matches)
    if (!tab.category) {
      if (all.length) groups.push({ key: tab.key, heading: tab.kind === 'provider' ? headings.provider : headings.none, entries: all })
      continue
    }
    for (const subcategoryId of [null, ...tab.subcategories.map(sub => sub.id)]) {
      const entries = all.filter(entry => entry.subcategoryId === subcategoryId)
      if (!entries.length) continue
      const sub = tab.subcategories.find(row => row.id === subcategoryId)
      groups.push({ key: `${tab.key}-${subcategoryId ?? 'general'}`, heading: sub ? `${tab.category.name} › ${sub.name}` : tab.category.name, entries })
    }
  }
  return groups
}

// ---- „Wer sieht sie?“ and the Bögen ---------------------------------------------------------------------------

/** Who sees an entry filed in the category row `id` (null: none – everyone): the category's and its parent's setting. */
export function filedVisibility(categories: readonly TemplateCategoryDto[], id: number | null): TemplateVisibility {
  const row = id === null ? undefined : categories.find(category => category.id === id)
  if (!row) return 'all'
  const parent = row.parentId === null ? undefined : categories.find(category => category.id === row.parentId)
  return stricterVisibility(row.visibility, parent?.visibility ?? 'all')
}

/** Whether `after` hides from some who saw `before`. */
export const narrows = (after: TemplateVisibility, before: TemplateVisibility): boolean =>
  TEMPLATE_VISIBILITIES.indexOf(after) > TEMPLATE_VISIBILITIES.indexOf(before)

/** Who no longer sees an entry when `before` becomes `after` (the key of de.templateLibrary.losers); null: nobody. */
export function losersOf(before: TemplateVisibility, after: TemplateVisibility): 'staff' | 'staffAndLeitung' | 'leitung' | null {
  if (!narrows(after, before)) return null
  if (after === 'managers') return 'staff'
  return before === 'managers' ? 'leitung' : 'staffAndLeitung'
}

/**
 * The Bögen that some who saw them would no longer see when the category (with its subcategories) gets the visibility
 * `next` (the server asks for the same confirmation), and who loses them (the widest loss among them).
 */
export function formsHiddenBy(
  category: TemplateCategoryDto, next: TemplateVisibility, categories: readonly TemplateCategoryDto[], forms: readonly FormTemplateDto[],
): { names: string[]; losers: ReturnType<typeof losersOf> } {
  const names: string[] = []
  let losers: ReturnType<typeof losersOf> = null
  const rank = { leitung: 0, staff: 1, staffAndLeitung: 2 } as const
  for (const form of forms) {
    const filedIn = form.subcategoryId ?? form.categoryId
    if (filedIn === null) continue
    const row = categories.find(other => other.id === filedIn)
    if (!row || (row.id !== category.id && row.parentId !== category.id)) continue
    const before = filedVisibility(categories, row.id)
    const changed = categories.map(other => (other.id === category.id ? { ...other, visibility: next } : other))
    const lost = losersOf(before, filedVisibility(changed, row.id))
    if (!lost) continue
    names.push(form.name)
    if (losers === null || rank[lost] > rank[losers]) losers = lost
  }
  return { names, losers }
}

/**
 * Whether the category (with its subcategories) holds entries of a kind the viewer does not maintain – then they may
 * rename it, but not change who sees it or move it (the server refuses that as well).
 */
export function holdsOtherKind(
  category: TemplateCategoryDto, categories: readonly TemplateCategoryDto[], rights: { pdfs: boolean; forms: boolean },
): boolean {
  const covered = [category, ...(category.parentId === null ? categories.filter(row => row.parentId === category.id) : [])]
  const pdfs = covered.some(row => row.templateCount > 0 || row.globalCount > 0)
  const forms = covered.some(row => row.formCount > 0)
  return (pdfs && !rights.pdfs) || (forms && !rights.forms)
}

/**
 * The new order of the entries one may move in a list after moving one a place up (-1) or down (1) among them (the
 * others keep their places; the server checks the same); null at an end.
 */
export function movedEntries(
  items: readonly LibraryEntry[], movable: (entry: LibraryEntry) => boolean, key: string, direction: -1 | 1,
): { type: LibraryEntry['type']; id: number }[] | null {
  const list = items.filter(movable)
  const at = list.findIndex(entry => entry.key === key)
  const to = at + direction
  if (at < 0 || to < 0 || to >= list.length) return null
  const next = [...list]
  ;[next[at], next[to]] = [next[to]!, next[at]!]
  return next.map(entry => ({ type: entry.type, id: entry.id }))
}
