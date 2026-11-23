/**
 * Text for searching (Vorlagen, Bögen, „Wissen“): composed (NFC, so an „ä“ typed or pasted as „a“ + „¨“ counts as
 * „ä“), lower case, umlauts as „ae/oe/ue“ and ß as „ss“ – „Ärzte“, „aerzte“ and „ÄRZTE“ meet, as do „Straße“ and
 * „Strasse“.
 */
export const searchFold = (text: string): string => text.normalize('NFC').toLocaleLowerCase('de')
  .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')

/** Whether every word of the search occurs in one of the texts (regardless of case and umlaut spelling; empty: all). */
export function matchesSearch(texts: readonly string[], query: string): boolean {
  const words = searchFold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = searchFold(texts.join(' '))
  return words.every(word => haystack.includes(word))
}
