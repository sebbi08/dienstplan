import { describe, expect, it } from 'vitest'
import {
  chosenKnowledgeTab, knowledgeTabs, linkHost, movableEntries, needsMyConfirmation, peopleByState, searchKnowledge,
} from '../../app/utils/knowledge'
import {
  KNOWLEDGE_STARTER_CATEGORIES, KNOWLEDGE_STARTER_LINKS, checkedAsOf, checkedKnowledgeUrl, confirmState, knowledgeMatches,
} from '../../shared/domain/knowledge'
import type { KnowledgeCategoryDto, KnowledgeConfirmationRowDto, KnowledgeEntryDto } from '../../shared/types/api'

const category = (id: number, name: string): KnowledgeCategoryDto => ({ id, name, visibility: 'all', entryCount: 0, ownCount: 0 })
const entry = (id: number, categoryId: number | null, overrides: Partial<KnowledgeEntryDto> = {}): KnowledgeEntryDto => ({
  id, categoryId, global: categoryId === null, globalCategoryName: null, globalVisibility: null, kind: 'link', title: `Eintrag ${id}`,
  description: '', asOf: null, url: 'https://example.de', body: '', fileSize: null, needsConfirmation: false, version: 1, versionAt: '2026-11-23T09:00:00.000Z',
  updatedAt: '2026-11-23T09:00:00.000Z', myConfirmation: null, canEdit: false, ...overrides,
})

describe('knowledge fields', () => {
  it('takes links with http or https only (javascript:, data: and other schemes never)', () => {
    expect(checkedKnowledgeUrl(' www.gesetze-im-internet.de/sgb_8/__8a.html ')).toBe('https://www.gesetze-im-internet.de/sgb_8/__8a.html')
    expect(checkedKnowledgeUrl('http://rki.de')).toBe('http://rki.de')
    for (const bad of ['', '  ', 'javascript:alert(1)', 'JavaScript:void(0)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', 'ftp://x.de', 'mailto:a@b.de', 'kein link']) {
      expect(checkedKnowledgeUrl(bad), bad).toBeNull()
    }
    expect(checkedKnowledgeUrl(`https://x.de/${'a'.repeat(490)}`)).toBeNull()
  })

  it('reads „Stand vom“ as a valid date or none', () => {
    expect(checkedAsOf('')).toBeNull()
    expect(checkedAsOf(null)).toBeNull()
    expect(checkedAsOf(' 2026-09-01 ')).toBe('2026-09-01')
    expect(checkedAsOf('2026-13-01')).toBeUndefined()
    expect(checkedAsOf('01.09.2026')).toBeUndefined()
  })

  it('searches title, description and the text without its formatting, every word, regardless of case', () => {
    const item = { title: 'Hygieneplan', description: 'Stand Kita Süd', body: '<p>Hände <strong>waschen</strong> vor dem Essen</p>' }
    expect(knowledgeMatches(item, '')).toBe(true)
    expect(knowledgeMatches(item, 'hygiene')).toBe(true)
    expect(knowledgeMatches(item, 'SÜD hände')).toBe(true)
    expect(knowledgeMatches(item, 'waschen essen')).toBe(true)
    // The tags are no text.
    expect(knowledgeMatches(item, 'strong')).toBe(false)
    expect(knowledgeMatches(item, 'hygiene impfung')).toBe(false)
  })

  it('tells the confirmation state of a person', () => {
    expect(confirmState(false, 3, { entryVersion: 1 })).toBe('none')
    expect(confirmState(true, 1, null)).toBe('open')
    expect(confirmState(true, 2, { entryVersion: 2 })).toBe('confirmed')
    expect(confirmState(true, 3, { entryVersion: 2 })).toBe('outdated')
  })

  it('has the five example categories and official starter links, each filed in one of them', () => {
    expect(KNOWLEDGE_STARTER_CATEGORIES.map(starter => starter.name))
      .toEqual(['Orientierungsplan', 'Aufsichtspflicht', 'Kinderschutz', 'Hygiene & Gesundheit', 'Gesetze & Vorgaben'])
    const keys = [...KNOWLEDGE_STARTER_CATEGORIES, ...KNOWLEDGE_STARTER_LINKS].map(starter => starter.key)
    expect(new Set(keys).size).toBe(keys.length)
    const official = /^https:\/\/(www\.gesetze-im-internet\.de|km\.baden-wuerttemberg\.de|www\.landesrecht-bw\.de|www\.rki\.de)\//
    for (const link of KNOWLEDGE_STARTER_LINKS) {
      expect(KNOWLEDGE_STARTER_CATEGORIES.map(starter => starter.name), link.key).toContain(link.category)
      expect(link.url, link.key).toMatch(official)
      expect(checkedKnowledgeUrl(link.url), link.key).toBe(link.url)
      expect(link.title.length, link.key).toBeLessThanOrEqual(120)
      expect(link.description.length, link.key).toBeLessThanOrEqual(500)
    }
  })
})

describe('the page „Wissen“', () => {
  it('shows a sub-tab per category (also empty ones) and „Vom Träger“ only when needed', () => {
    const categories = [category(1, 'Kinderschutz'), category(2, 'Hygiene')]
    const entries = [entry(1, 2), entry(2, 1), entry(3, 2, { global: true })]
    const tabs = knowledgeTabs(categories, entries)
    expect(tabs.map(tab => [tab.key, tab.entries.map(item => item.id)])).toEqual([['category-1', [2]], ['category-2', [1, 3]]])
    expect(movableEntries(tabs[1]!).map(item => item.id)).toEqual([1])
    const withProvider = knowledgeTabs(categories, [...entries, entry(4, null)])
    expect(withProvider.at(-1)).toMatchObject({ key: 'provider', category: null })
    expect(chosenKnowledgeTab(tabs, 'category-2')).toBe('category-2')
    expect(chosenKnowledgeTab(tabs, 'provider')).toBe('category-1')
    expect(chosenKnowledgeTab([], null)).toBeNull()
  })

  it('searches across all categories', () => {
    const entries = [entry(1, 1, { title: 'Hygieneplan' }), entry(2, 2, { kind: 'text', body: '<p>Hygiene im Bad</p>', title: 'Bad' }), entry(3, 2)]
    expect(searchKnowledge(entries, 'hygiene').map(item => item.id)).toEqual([1, 2])
  })

  it('names the host of a link and who still has to confirm', () => {
    expect(linkHost('https://www.gesetze-im-internet.de/ifsg/__34.html')).toBe('gesetze-im-internet.de')
    expect(linkHost('kein link')).toBe('kein link')
    expect(needsMyConfirmation(entry(1, 1))).toBe(false)
    expect(needsMyConfirmation(entry(1, 1, { myConfirmation: { state: 'outdated', confirmedAt: 'x' } }))).toBe(true)
    expect(needsMyConfirmation(entry(1, 1, { myConfirmation: { state: 'confirmed', confirmedAt: 'x' } }))).toBe(false)
    const person = (employeeId: number, state: KnowledgeConfirmationRowDto['state']): KnowledgeConfirmationRowDto =>
      ({ employeeId, name: `P${employeeId}`, state, confirmedAt: null, via: null, expected: true })
    const grouped = peopleByState([person(1, 'open'), person(2, 'confirmed'), person(3, 'outdated'), person(4, 'open')])
    expect([grouped.open, grouped.outdated, grouped.confirmed].map(list => list.map(item => item.employeeId))).toEqual([[1, 4], [3], [2]])
  })
})
