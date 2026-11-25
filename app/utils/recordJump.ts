/**
 * The jump bar of the child record (ChildRecordJumpBar.vue): the record's sections in page order, the element id of
 * each, and which one is "current" while scrolling.
 */
export const RECORD_SECTIONS = [
  'master', 'contacts', 'health', 'notes', 'consents', 'documents', 'development', 'meetings', 'forms', 'accidents', 'lifecycle',
] as const
export type RecordSection = typeof RECORD_SECTIONS[number]

/** The id of the element around a section of the record. */
export const recordSectionId = (key: RecordSection): string => `akte-${key}`

/** Where a shown section starts, relative to the top of the window (getBoundingClientRect().top). */
export interface SectionTop { key: RecordSection; top: number }

/**
 * The section to highlight: the last one whose start has passed `line` (the bottom of the sticky header and bar, plus a
 * little), else the first. At the end of the page the last sections cannot reach the line: there the one just jumped to
 * (`preferred`) counts while it is in view (its start above `viewportHeight`), else the last one.
 */
export function currentRecordSection(
  tops: readonly SectionTop[], line: number, options: { atBottom?: boolean; preferred?: RecordSection | null; viewportHeight?: number } = {},
): RecordSection | null {
  if (tops.length === 0) return null
  if (options.atBottom) {
    const preferred = tops.find(entry => entry.key === options.preferred)
    if (preferred && preferred.top < (options.viewportHeight ?? Infinity)) return preferred.key
    return tops.at(-1)!.key
  }
  let current = tops[0]!.key
  for (const entry of tops) {
    if (entry.top <= line) current = entry.key
  }
  return current
}

/**
 * Where to scroll so the section starts just below the sticky header and bar: its page position minus that offset.
 * On phones the header slides away while scrolling down beyond its first 64 px (useHideOnScroll), so going down there
 * only the bar counts.
 */
export function recordScrollTarget(
  sectionTop: number, scrollY: number, sizes: { header: number; bar: number; headerHides: boolean; gap?: number },
): number {
  const pageTop = sectionTop + scrollY
  const below = pageTop - sizes.bar - (sizes.gap ?? 8)
  const withHeader = below - sizes.header
  const target = sizes.headerHides && withHeader > scrollY && withHeader > 64 ? below : withHeader
  return Math.max(0, Math.round(target))
}
