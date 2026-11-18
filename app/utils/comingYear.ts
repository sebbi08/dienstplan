import type { IsoDate } from '#shared/domain/types'

/**
 * Whether the leave pages also show the coming year below the viewed one: from 1 October to 31 December, and only
 * while the viewed year is the current one. `todayIso` is the Berlin date.
 */
export function showsComingYear(todayIso: IsoDate, viewedYear: number): boolean {
  const year = Number(todayIso.slice(0, 4))
  const month = Number(todayIso.slice(5, 7))
  return viewedYear === year && month >= 10
}
