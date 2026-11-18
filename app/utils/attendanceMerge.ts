// The sections of the "Anwesenheit" day list while groups are merged („Gruppen zusammenlegen“).
import { mergedPresent } from '#shared/domain/groupMerges'
import type { AttendanceChildDto, GroupMergeDto } from '#shared/types/api'
import { attendanceSearchKey, filterAttendanceChildren } from './attendanceSearch'

type Row = Pick<AttendanceChildDto, 'childId' | 'status' | 'stays' | 'firstName' | 'lastName' | 'name'>

/** A group's section of the list: its key and all its children of the day. */
export interface GroupSection<T> { key: string; groupId: number | null; name: string; rows: T[] }

/**
 * The sections in the order listed: first one per merge with its children here now (`rows`, in the facility's order),
 * those to list (`shown`, the search hits) and the children of its groups not arrived yet (`waiting`, status „noch nicht
 * da“, in the same order; for the line „Noch nicht da“ below the merge, empty while searching). Then the groups with the
 * children to list (`hits`). A merged group's own section is left out; while a search is typed it lists its hits that
 * are not in the merge's section (children not yet here, picked up or absent), so every child can still be found, and
 * its `rows` (counted in the heading) are those children only, never one of the merge above. While searching, a
 * section without hits is left out.
 */
export function attendanceListSections<T extends Row, G extends GroupSection<T>>(
  groups: G[], merges: Pick<GroupMergeDto, 'id' | 'groupIds' | 'childIds'>[], children: T[], search: string,
): { merged: { id: number; groupIds: number[]; rows: T[]; shown: T[]; waiting: T[] }[]; groups: (G & { hits: T[] })[] } {
  const searching = attendanceSearchKey(search) !== ''
  const byId = new Map(children.map(child => [child.childId, child]))
  const merged = merges.map((merge) => {
    const rows = mergedPresent(merge.childIds, children)
    const waiting = searching
      ? []
      : merge.childIds.flatMap((childId) => {
          const child = byId.get(childId)
          return child?.status === 'not_yet' ? [child] : []
        })
    return { id: merge.id, groupIds: merge.groupIds, rows, shown: filterAttendanceChildren(rows, search), waiting }
  })
  const mergedGroups = new Set(merges.flatMap(merge => merge.groupIds))
  const inMerged = new Set(merged.flatMap(section => section.rows.map(row => row.childId)))
  return {
    merged: merged.filter(section => !searching || section.shown.length > 0),
    groups: groups.flatMap((group) => {
      const isMerged = group.groupId !== null && mergedGroups.has(group.groupId)
      if (isMerged && !searching) return []
      const rows = isMerged ? group.rows.filter(row => !inMerged.has(row.childId)) : group.rows
      const hits = filterAttendanceChildren(rows, search)
      return searching && hits.length === 0 ? [] : [{ ...group, rows, hits }]
    }),
  }
}

/**
 * Runs a merge or end request through `run` (which reloads on success) and reloads the day data when it failed too:
 * another tablet may have merged or ended meanwhile, and the list then shows how things are now. Returns `run`'s answer.
 */
export async function reloadAfterFailure(run: () => Promise<boolean>, reload: () => Promise<unknown>): Promise<boolean> {
  const ok = await run()
  if (!ok) await reload()
  return ok
}
