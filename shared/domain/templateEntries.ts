/**
 * „Dokumente“ → „Vorlagen“ holds two kinds of entries side by side in the facility's categories (template_categories):
 * Bögen (form templates, filled in the app) and PDF templates (printed or filled as PDF). Each list – the entries
 * directly in a category, or those of one subcategory – has one order across both kinds (▲/▼): a PDF's place in the
 * facility is its print_template_order row, a Bogen's its sort_order, numbered together (0, 1, …) whenever the list is
 * ordered or gets a new entry. The rules both sides share.
 */

/** The kind of an entry: a Bogen („form“) or a PDF template („pdf“). */
export const TEMPLATE_ENTRY_TYPES = ['form', 'pdf'] as const
export type TemplateEntryType = typeof TEMPLATE_ENTRY_TYPES[number]

/**
 * 0133_one_template_library moved every Bogen's place up by this, so in a list that holds both kinds since then the
 * PDF templates stay first (as they were, also those without a place) and the Bögen follow in their order, until the
 * list is numbered afresh.
 */
export const MERGED_BOGEN_PLACE = 1_000_000

/** An entry of a list as far as its order goes: its kind, id and place (null: a PDF of before without one). */
export interface PlacedEntry {
  type: TemplateEntryType
  id: number
  place: number | null
}

/**
 * Where an entry stands: those with a place below MERGED_BOGEN_PLACE by place, then the PDF templates of before without
 * a place (in the order they come), then the Bögen with a place from 0133 by place. At the same place the PDF first.
 */
function rank(entry: PlacedEntry): [number, number, number] {
  const typeRank = entry.type === 'pdf' ? 0 : 1
  if (entry.place === null) return [1, 0, typeRank]
  return [entry.place < MERGED_BOGEN_PLACE ? 0 : 2, entry.place, typeRank]
}

/** Which of two entries of different lists comes first (negative: `a`). */
export function compareEntryPlaces(a: PlacedEntry, b: PlacedEntry): number {
  const [aClass, aPlace, aType] = rank(a)
  const [bClass, bPlace, bType] = rank(b)
  return aClass - bClass || aPlace - bPlace || aType - bType
}

/**
 * One list of a category from its PDF templates and its Bögen, each already in its own order (the server's): merged by
 * place, so each kind keeps its order and the two interleave as they were ordered.
 */
export function mergeEntries<P extends PlacedEntry, F extends PlacedEntry>(pdfs: readonly P[], forms: readonly F[]): (P | F)[] {
  const merged: (P | F)[] = []
  let p = 0
  let f = 0
  while (p < pdfs.length || f < forms.length) {
    const pdf = pdfs[p]
    const form = forms[f]
    if (pdf && (!form || compareEntryPlaces(pdf, form) <= 0)) {
      merged.push(pdf)
      p++
    }
    else {
      merged.push(form!)
      f++
    }
  }
  return merged
}

/** The key that tells an entry apart in a list of both kinds („pdf-3“, „form-3“). */
export const entryKey = (entry: Pick<PlacedEntry, 'type' | 'id'>): string => `${entry.type}-${entry.id}`
