/**
 * Where the app goes after the Träger switched the facility: the same page for the new facility, except pages of one
 * record of the old facility (an employee, a child, a cash box, a team meeting, a group, an own talk form), which go to
 * the list of their area. The query is dropped, because it may name records of the old facility (e.g. ?employee=5).
 */
const RECORD_PAGES: readonly [RegExp, string][] = [
  [/^\/admin\/employees\/.+/, '/admin/employees'],
  [/^\/children\/.+/, '/children'],
  [/^\/cash\/.+/, '/cash'],
  [/^\/team-meetings\/.+/, '/team-meetings'],
  [/^\/admin\/settings\/groups\/.+/, '/admin/settings/groups'],
  [/^\/my\/talks\/.+/, '/my/talks'],
]

export function pathAfterFacilitySwitch(path: string): string {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/'
  for (const [pattern, list] of RECORD_PAGES) if (pattern.test(clean)) return list
  return clean
}
