/** How the facility orders the children inside each group (Anwesenheit, Liste, Übersicht and their printouts). */
export const CHILD_SORTS = ['first_asc', 'first_desc', 'last_asc', 'last_desc', 'age_asc', 'age_desc'] as const
export type ChildSort = (typeof CHILD_SORTS)[number]

/** The default is the order the lists always had: oldest first. */
export const DEFAULT_CHILD_SORT: ChildSort = 'age_desc'

export function isChildSort(value: unknown): value is ChildSort {
  return typeof value === 'string' && (CHILD_SORTS as readonly string[]).includes(value)
}

interface SortableChild { firstName: string; lastName: string; birthDate: string }

const text = (a: string, b: string) => a.localeCompare(b, 'de')

/**
 * The comparator of one sort setting. Name sorts fall back to the other name part, then the birth date; age sorts
 * (age_asc = youngest first, age_desc = oldest first) fall back to the first name, then the last name. German collation.
 */
export function childComparator(sort: ChildSort): (a: SortableChild, b: SortableChild) => number {
  const first = (a: SortableChild, b: SortableChild) => text(a.firstName, b.firstName)
  const last = (a: SortableChild, b: SortableChild) => text(a.lastName, b.lastName)
  const born = (a: SortableChild, b: SortableChild) => a.birthDate.localeCompare(b.birthDate)
  switch (sort) {
    case 'first_asc': return (a, b) => first(a, b) || last(a, b) || born(a, b)
    case 'first_desc': return (a, b) => first(b, a) || last(b, a) || born(a, b)
    case 'last_asc': return (a, b) => last(a, b) || first(a, b) || born(a, b)
    case 'last_desc': return (a, b) => last(b, a) || first(b, a) || born(a, b)
    // Older = earlier birth date.
    case 'age_desc': return (a, b) => born(a, b) || first(a, b) || last(a, b)
    case 'age_asc': return (a, b) => born(b, a) || first(a, b) || last(a, b)
  }
}
