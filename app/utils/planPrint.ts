/**
 * The plan's printout (print view and PDF) on A4 landscape: the columns have fixed widths there, so a plan's width is
 * known beforehand. A plan wider than the page is scaled down to the page width, at most to PRINT_MIN_ZOOM so it stays
 * readable; a plan that would need more is split into parts by its columns (each part on its own pages, the date column
 * repeated, the Info columns in the last part), and all parts get the same scale.
 */

/** The page's content width in CSS px: A4 landscape (297 mm) minus 2 × 8 mm margin (app/assets/css/main.css), 96 px per inch. */
export const PRINT_PAGE_WIDTH = 1062
/** The printed columns' widths in CSS px (the print view's root font is 10 px). */
export const PRINT_WIDTHS = { date: 84, employee: 76, attendance: 36, info: 110 } as const
/** Smaller than this the text gets hard to read: such a plan is split instead. */
export const PRINT_MIN_ZOOM = 0.8

export type PrintColumnKind = 'employee' | 'attendance'

/** A part of the printout: the columns from…to (exclusive) of the plan, with the Info columns or not. */
export interface PrintPart { from: number; to: number; withInfo: boolean; width: number }

export interface PrintLayout { parts: PrintPart[]; zoom: number }

/** The plan's columns as PlanGrid lays them out (planBlocks): each block's people, then its group's „anwesend“ column. */
export function planColumnKinds(blocks: readonly { employees: readonly unknown[]; groupId: number | null }[]): PrintColumnKind[] {
  return blocks.flatMap(block => [
    ...block.employees.map(() => 'employee' as const),
    ...(block.groupId !== null ? ['attendance' as const] : []),
  ])
}

function width(kinds: readonly PrintColumnKind[], withInfo: boolean): number {
  return PRINT_WIDTHS.date + kinds.reduce((sum, kind) => sum + PRINT_WIDTHS[kind], 0) + (withInfo ? 2 * PRINT_WIDTHS.info : 0)
}

/**
 * Splits the columns into the fewest parts that fit the page at PRINT_MIN_ZOOM, cutting near equal widths and never
 * before a group's „anwesend“ column (it stays with its group's last person). Every part gets the zoom of the widest.
 */
export function printLayout(kinds: readonly PrintColumnKind[]): PrintLayout {
  const max = PRINT_PAGE_WIDTH / PRINT_MIN_ZOOM
  const total = width(kinds, true)
  let parts: PrintPart[] = [{ from: 0, to: kinds.length, withInfo: true, width: total }]
  for (let count = 2; count <= kinds.length && parts.some(part => part.width > max); count += 1) {
    parts = split(kinds, count)
  }
  const widest = Math.max(...parts.map(part => part.width))
  return { parts, zoom: Math.min(1, PRINT_PAGE_WIDTH / widest) }
}

function split(kinds: readonly PrintColumnKind[], count: number): PrintPart[] {
  const columnsWidth = kinds.reduce((sum, kind) => sum + PRINT_WIDTHS[kind], 0) + 2 * PRINT_WIDTHS.info
  const parts: PrintPart[] = []
  let from = 0
  let used = 0
  for (let part = 1; part < count; part += 1) {
    const target = (columnsWidth * part) / count
    let to = from
    // Up to the cut nearest the target width.
    while (to < kinds.length && Math.abs(used + PRINT_WIDTHS[kinds[to]!] - target) <= Math.abs(used - target)) {
      used += PRINT_WIDTHS[kinds[to]!]
      to += 1
    }
    while (to < kinds.length && kinds[to] === 'attendance') {
      used += PRINT_WIDTHS.attendance
      to += 1
    }
    if (to === from && to < kinds.length) {
      used += PRINT_WIDTHS[kinds[to]!]
      to += 1
    }
    parts.push({ from, to, withInfo: false, width: width(kinds.slice(from, to), false) })
    from = to
  }
  parts.push({ from, to: kinds.length, withInfo: true, width: width(kinds.slice(from), true) })
  return parts.filter(part => part.to > part.from || part.withInfo)
}
