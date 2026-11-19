import type { CalendarKind, YearCalendarDto } from '#shared/types/api'

/**
 * The legend lines shown only when the calendar holds such a day: „Mutterschutz / Beschäftigungsverbot“ reaches only
 * viewers who may see the case (the server sends everybody else „abwesend“), and „abwesend“ itself only where it occurs,
 * so the legend never puts the two side by side for someone without the right.
 */
export const CONDITIONAL_KINDS: readonly CalendarKind[] = ['maternity', 'absent']

/** The kinds that occur in the calendar's days. */
export function presentKinds(days: YearCalendarDto['days'] | null | undefined): Set<CalendarKind> {
  const kinds = new Set<CalendarKind>()
  for (const row of Object.values(days ?? {})) for (const kind of Object.values(row)) kinds.add(kind)
  return kinds
}

/** Whether the legend lists the kind: always, unless it is one of CONDITIONAL_KINDS absent from the days. */
export function legendShowsKind(kind: CalendarKind, present: ReadonlySet<CalendarKind>): boolean {
  return !CONDITIONAL_KINDS.includes(kind) || present.has(kind)
}
