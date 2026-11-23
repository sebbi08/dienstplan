import { normalizedWebsite } from './contacts'
import { matchesSearch } from './documentTargets'
import { isValidIsoDate } from './dates'
import { richTextToPlain } from './richText'
import type { GermanState } from './states'

/**
 * „Wissen“ (Dokumente → Wissen): the facility's knowledge library – PDFs, links to official pages and short formatted
 * texts – in categories of the facility's own with a visibility like the print template categories (all / Leitung and
 * Träger / Träger only). An entry may ask its readers for „Gelesen und verstanden“; a change of its content asks again.
 */

/** What an entry holds: a PDF file, a link (http/https) or a short formatted text. */
export const KNOWLEDGE_KINDS = ['file', 'link', 'text'] as const
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number]

/** The longest texts of an entry and of a category name (the form and the server use the same). */
export const KNOWLEDGE_LIMITS = { title: 120, description: 500, url: 500, categoryName: 60 } as const

/** Names that differ only in case (umlauts included), surrounding spaces or ß/ss count as the same. */
export const comparableKnowledgeName = (name: string) => name.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss')

/**
 * The link as it is stored and opened: http or https only (without a scheme „https://“ is put in front); null for
 * anything else – another scheme such as javascript: or data:, spaces, no host, empty, or longer than the limit.
 */
export function checkedKnowledgeUrl(value: string): string | null {
  const url = normalizedWebsite(value)
  return url === null || url === '' || url.length > KNOWLEDGE_LIMITS.url ? null : url
}

/** „Stand vom“: a valid date (YYYY-MM-DD), or null for none (empty); undefined for anything else. */
export function checkedAsOf(value: string | null | undefined): string | null | undefined {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return null
  return isValidIsoDate(trimmed) ? trimmed : undefined
}

/** The fields the search looks into: title, description and the text of a text entry (without its formatting). */
export interface SearchableKnowledge {
  title: string
  description: string
  body: string
}

/**
 * Whether the entry matches every word of the search (regardless of case and umlaut spelling, „ae“ for „ä“; an empty
 * search matches all), as the search of the Vorlagen.
 */
export function knowledgeMatches(entry: SearchableKnowledge, query: string): boolean {
  return matchesSearch([entry.title, entry.description, entry.body ? richTextToPlain(entry.body) : ''], query)
}

/**
 * The confirmation state of an entry for one person: not asked (the entry asks nobody), open, confirmed (the current
 * version), or an earlier version confirmed (the entry changed since, so it asks again).
 */
export type KnowledgeConfirmState = 'none' | 'open' | 'confirmed' | 'outdated'

export function confirmState(
  needsConfirmation: boolean, version: number, confirmation: { entryVersion: number } | null | undefined,
): KnowledgeConfirmState {
  if (!needsConfirmation) return 'none'
  if (!confirmation) return 'open'
  return confirmation.entryVersion >= version ? 'confirmed' : 'outdated'
}

// ---- starters ----------------------------------------------------------------

/** A category every facility starts with (visible to all), recorded by its key so it never comes back once deleted. */
export interface KnowledgeStarterCategory { key: string; name: string }

/**
 * A subcategory every facility (of the named states) starts with, in the starter category of that name (visible to all),
 * recorded by its key like the categories.
 */
export interface KnowledgeStarterSubcategory {
  key: string
  category: string
  name: string
  /** Only facilities in these states get it; all facilities without. */
  states?: readonly GermanState[]
}

/**
 * A link every facility (of the named states) starts with, filed in the starter category of that name – in its starter
 * subcategory of that name when the facility has it, otherwise directly in the category.
 */
export interface KnowledgeStarterLink {
  key: string
  category: string
  subcategory?: string
  title: string
  description: string
  url: string
  /** Only facilities in these states get it (state law); all facilities without. */
  states?: readonly GermanState[]
}

/**
 * The example categories, in this order. Every existing facility gets them once at the next start, a new facility
 * when it is created (server/services/knowledge.ts, knowledge_starter_seeds); deleted or renamed ones do not come back.
 */
export const KNOWLEDGE_STARTER_CATEGORIES: readonly KnowledgeStarterCategory[] = [
  { key: 'category:orientierungsplan', name: 'Orientierungsplan' },
  { key: 'category:aufsichtspflicht', name: 'Aufsichtspflicht' },
  { key: 'category:kinderschutz', name: 'Kinderschutz' },
  { key: 'category:hygiene', name: 'Hygiene & Gesundheit' },
  { key: 'category:gesetze', name: 'Gesetze & Vorgaben' },
]

/**
 * The example subcategories, in this order: „Gesetze & Vorgaben“ → „Bund“ and (in Baden-Württemberg) „Baden-Württemberg“.
 * A new facility gets them when it is created; a facility that already had the starters got them with
 * 0115_subcategories (when it still had „Gesetze & Vorgaben“), which also recorded them, so they never come back.
 */
export const KNOWLEDGE_STARTER_SUBCATEGORIES: readonly KnowledgeStarterSubcategory[] = [
  { key: 'subcategory:gesetze-bund', category: 'Gesetze & Vorgaben', name: 'Bund' },
  { key: 'subcategory:gesetze-bw', category: 'Gesetze & Vorgaben', name: 'Baden-Württemberg', states: ['BW'] },
]

/**
 * The starter links, only official sources (each checked to load when it was added, 2026-11-23). Like the categories,
 * each comes once per facility; one whose category the facility no longer has (deleted or renamed) is skipped and
 * recorded all the same.
 */
export const KNOWLEDGE_STARTER_LINKS: readonly KnowledgeStarterLink[] = [
  {
    key: 'link:orientierungsplan-bw', category: 'Orientierungsplan', states: ['BW'],
    title: 'Orientierungsplan für Bildung und Erziehung in Baden-Württemberg',
    description: 'Der Orientierungsplan für baden-württembergische Kindergärten und weitere Kindertageseinrichtungen (Kultusministerium Baden-Württemberg).',
    url: 'https://km.baden-wuerttemberg.de/de/fruehe-bildung/orientierungsplan',
  },
  {
    key: 'link:bgb-832', category: 'Aufsichtspflicht',
    title: '§ 832 BGB – Haftung des Aufsichtspflichtigen',
    description: 'Die gesetzliche Grundlage der Aufsichtspflicht (Bürgerliches Gesetzbuch, gesetze-im-internet.de).',
    url: 'https://www.gesetze-im-internet.de/bgb/__832.html',
  },
  {
    key: 'link:sgb8-8a', category: 'Kinderschutz',
    title: '§ 8a SGB VIII – Schutzauftrag bei Kindeswohlgefährdung',
    description: 'Der Schutzauftrag der Einrichtungen bei Anhaltspunkten für eine Kindeswohlgefährdung (gesetze-im-internet.de).',
    url: 'https://www.gesetze-im-internet.de/sgb_8/__8a.html',
  },
  {
    key: 'link:ifsg-34', category: 'Hygiene & Gesundheit',
    title: '§ 34 IfSG – Gesundheitliche Anforderungen, Mitwirkungspflichten',
    description: 'Wann Kinder und Beschäftigte die Einrichtung bei ansteckenden Krankheiten nicht besuchen dürfen (Infektionsschutzgesetz, gesetze-im-internet.de).',
    url: 'https://www.gesetze-im-internet.de/ifsg/__34.html',
  },
  {
    key: 'link:rki-wiederzulassung', category: 'Hygiene & Gesundheit',
    title: 'RKI-Ratgeber: Wiederzulassung zu Gemeinschaftseinrichtungen',
    description: 'Die Empfehlungen des Robert Koch-Instituts, ab wann Kinder nach einer Erkrankung wieder kommen dürfen (§ 34 IfSG).',
    url: 'https://www.rki.de/DE/Aktuelles/Publikationen/RKI-Ratgeber/Wiederzulassung/Mbl_Wiederzulassung_schule.html',
  },
  {
    key: 'link:sgb8-45', category: 'Gesetze & Vorgaben', subcategory: 'Bund',
    title: '§ 45 SGB VIII – Erlaubnis für den Betrieb einer Einrichtung',
    description: 'Die Betriebserlaubnis und ihre Voraussetzungen (gesetze-im-internet.de).',
    url: 'https://www.gesetze-im-internet.de/sgb_8/__45.html',
  },
  {
    key: 'link:sgb8-47', category: 'Gesetze & Vorgaben', subcategory: 'Bund',
    title: '§ 47 SGB VIII – Melde- und Dokumentationspflichten',
    description: 'Was der Träger der Aufsichtsbehörde melden muss, z. B. besondere Ereignisse (gesetze-im-internet.de).',
    url: 'https://www.gesetze-im-internet.de/sgb_8/__47.html',
  },
  {
    key: 'link:kitag-bw', category: 'Gesetze & Vorgaben', subcategory: 'Baden-Württemberg', states: ['BW'],
    title: 'Kindertagesbetreuungsgesetz Baden-Württemberg (KiTaG)',
    description: 'Das Landesgesetz über die Betreuung und Förderung von Kindern in Kindertageseinrichtungen (Landesrecht BW).',
    url: 'https://www.landesrecht-bw.de/bsbw/document/jlr-KiTaGBWrahmen',
  },
]
