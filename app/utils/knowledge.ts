import { knowledgeMatches } from '#shared/domain/knowledge'
import type { KnowledgeCategoryDto, KnowledgeConfirmationRowDto, KnowledgeEntryDto } from '#shared/types/api'

/** The key of the sub-tab „Vom Träger“: entries for all facilities without a category of their name in the facility. */
export const KNOWLEDGE_PROVIDER_TAB = 'provider'

/** A sub-tab of „Dokumente“ → „Wissen“: a category of the facility, or „Vom Träger“ (`category` null). */
export interface KnowledgeTab {
  key: string
  category: KnowledgeCategoryDto | null
  entries: KnowledgeEntryDto[]
}

/**
 * The sub-tabs: every category the viewer sees (the server lists only those), in the facility's order, also an empty
 * one; then „Vom Träger“ when entries for all facilities fit no category of the facility. The entries in the server's
 * order (the facility's own by ▲/▼, then the Träger's by title).
 */
export function knowledgeTabs(categories: readonly KnowledgeCategoryDto[], entries: readonly KnowledgeEntryDto[]): KnowledgeTab[] {
  const tabs: KnowledgeTab[] = categories.map(category => ({
    key: `category-${category.id}`,
    category,
    entries: entries.filter(entry => entry.categoryId === category.id),
  }))
  const fromProvider = entries.filter(entry => entry.categoryId === null)
  if (fromProvider.length > 0) tabs.push({ key: KNOWLEDGE_PROVIDER_TAB, category: null, entries: fromProvider })
  return tabs
}

/** The sub-tab to open: the one asked for (or remembered) when it is there, else the first. */
export function chosenKnowledgeTab(tabs: readonly KnowledgeTab[], wanted: string | null): string | null {
  return tabs.find(tab => tab.key === wanted)?.key ?? tabs[0]?.key ?? null
}

/** The entries matching the search (title, description, text) in every category, in the server's order. */
export function searchKnowledge(entries: readonly KnowledgeEntryDto[], query: string): KnowledgeEntryDto[] {
  return entries.filter(entry => knowledgeMatches(entry, query))
}

/** The facility's own entries of a sub-tab, which ▲/▼ moves (the Träger's follow them by title). */
export const movableEntries = (tab: KnowledgeTab): KnowledgeEntryDto[] => tab.entries.filter(entry => !entry.global)

/** Where the PDF of a file entry is served (shown in the browser). */
export const knowledgeFileUrl = (id: number): string => `/api/knowledge/${id}/file`

/** The printed proof of who confirmed an entry. */
export const knowledgePrintPath = (id: number): string => `/print/knowledge/${id}`

/** The host of a link for showing („gesetze-im-internet.de“), without „www.“; the link itself when it is no URL. */
export function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '')
  }
  catch {
    return url
  }
}

/** Whether the person still has to confirm the entry (never, or only an earlier version). */
export const needsMyConfirmation = (entry: Pick<KnowledgeEntryDto, 'myConfirmation'>): boolean =>
  entry.myConfirmation?.state === 'open' || entry.myConfirmation?.state === 'outdated'

/** The people of the overview by state: not yet, only an earlier version, confirmed. */
export function peopleByState(people: readonly KnowledgeConfirmationRowDto[]) {
  return {
    open: people.filter(person => person.state === 'open'),
    outdated: people.filter(person => person.state === 'outdated'),
    confirmed: people.filter(person => person.state === 'confirmed'),
  }
}

const TAB_MEMORY_KEY = 'dienstplan.knowledgeTab'

/** The sub-tab this device opened last; null when storage is unavailable. */
export function readKnowledgeTabMemory(): string | null {
  try {
    return localStorage.getItem(TAB_MEMORY_KEY)
  }
  catch {
    return null
  }
}

export function writeKnowledgeTabMemory(key: string): void {
  try {
    localStorage.setItem(TAB_MEMORY_KEY, key)
  }
  catch {
    // Not remembered; switching still works on this page.
  }
}
