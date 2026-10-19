import type { IsoDate } from '#shared/domain/types'

/**
 * The staff page's two lists: the active employees, and those who already left (their last day `leftOn` is before
 * today), which the page shows in a closed section at its end. Someone leaving today or later is still active.
 * Both lists keep the given order.
 */
export function splitLeavers<T extends { leftOn: IsoDate | null }>(list: readonly T[], today: IsoDate): { active: T[]; archived: T[] } {
  const active: T[] = []
  const archived: T[] = []
  for (const employee of list) (employee.leftOn !== null && employee.leftOn < today ? archived : active).push(employee)
  return { active, archived }
}
