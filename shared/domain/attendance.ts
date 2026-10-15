import type { DomainEntry, IsoDate } from './types'
import { isTargetGapCode } from './warnings'

/** A duty with working time: a shift or special shift counting as staff, or a timed VZ / Büro; never a break or absence. */
export function hasWorkingTime(entry: DomainEntry): boolean {
  if (entry.kind === 'shift' || entry.kind === 'special') return entry.countsAsStaff
  return entry.kind === 'code' && entry.countsAsStaff && isTargetGapCode(entry.codeKey) && entry.start !== null && entry.end !== null
}

/**
 * Per group (keyed by id) and date: the number of persons with at least one duty with working time whose effective
 * group (the entry's group, otherwise the person's home group) it is. Only the plan's own cells count: entries planned
 * in another facility (help-elsewhere markers) never do. Duties without an effective group count nowhere.
 */
export function groupAttendance(
  facilityId: number,
  groupIds: number[],
  homeGroups: Map<number, number | null>,
  entries: (DomainEntry & { helpFacilityId?: number | null })[],
  dates: IsoDate[],
): Record<string, Record<IsoDate, number>> {
  const persons = new Map<string, Set<number>>()
  for (const entry of entries) {
    if (entry.helpFacilityId != null && entry.helpFacilityId !== facilityId) continue
    if (!hasWorkingTime(entry)) continue
    const groupId = entry.groupId ?? homeGroups.get(entry.employeeId) ?? null
    if (groupId === null) continue
    const key = `${groupId}|${entry.date}`
    persons.set(key, (persons.get(key) ?? new Set()).add(entry.employeeId))
  }
  return Object.fromEntries(groupIds.map(groupId => [
    String(groupId),
    Object.fromEntries(dates.map(date => [date, persons.get(`${groupId}|${date}`)?.size ?? 0])),
  ]))
}
