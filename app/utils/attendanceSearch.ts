// The search field „Kind suchen“ of the "Anwesenheit" day list: filters as you type, never remembered.
import type { AttendanceChildDto } from '#shared/types/api'

type Searchable = Pick<AttendanceChildDto, 'firstName' | 'lastName' | 'name'>

/** A text as compared by the search: lower case, accents dropped ("ä" → "a", via NFD), spaces trimmed and single. */
export function attendanceSearchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()
}

/**
 * Whether the child is a hit: the search is part of the first name, the last name, "Vorname Nachname" or the name as the
 * list shows it ("Nachname, Vorname"); case and accents do not count. An empty search finds everyone.
 */
export function matchesAttendanceSearch(child: Searchable, search: string): boolean {
  const key = attendanceSearchKey(search)
  if (key === '') return true
  return [child.firstName, child.lastName, `${child.firstName} ${child.lastName}`, child.name]
    .some(text => attendanceSearchKey(text).includes(key))
}

/** The hits of a list, in its order. */
export function filterAttendanceChildren<T extends Searchable>(rows: T[], search: string): T[] {
  return attendanceSearchKey(search) === '' ? rows : rows.filter(row => matchesAttendanceSearch(row, search))
}
