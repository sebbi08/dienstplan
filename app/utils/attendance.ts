import type { MonthCell } from '#shared/types/api'

/** The sign of a cell in the month table: ✓ here, K sick, U vacation, E excused, – unexcused, nothing for an empty day. */
export const MONTH_CELL_SYMBOL: Record<MonthCell, string> = {
  present: '✓', sick: 'K', vacation: 'U', excused: 'E', unexcused: '–', none: '',
}
