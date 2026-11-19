import { and, eq, isNull } from 'drizzle-orm'
import { childStatus } from '../../shared/domain/children'
import { groupOnDay } from '../../shared/domain/occupancy'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IfsgCaseInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childIfsgCases } from '../db/schema'
import { loadChild } from '../lib/childRecord'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { setAbsence } from './childAttendance'
import { groupHistories } from './childGroupChanges'
import { checkedCaseRule, ifsgRulesFor, seesIfsgDisease } from './ifsg'

/**
 * A new § 34 IfSG case of a child on an attendance day (not ahead: 400 attendance_future), entered by whoever keeps the
 * attendance of the child's group that day or by Leitung/Träger (403 group_read_only otherwise; 404 child_not_found
 * for a child not active then). The disease, its kind and the date rule are checked against the facility's rules (see
 * `checkedCaseRule`); the onset lies on or before the day (400 invalid_date). A second open case of the same disease:
 * 409 ifsg_case_open. Like the absence dialog it books the day's absence too: „krank“ for the sick, „entschuldigt“ for
 * a carrier or a household contact (who are not ill themselves); a day with a stay keeps the stay. Returns the id.
 */
export function createIfsgCase(db: Db, viewer: ChildViewer, input: IfsgCaseInput, now: Date = new Date()): number {
  if (input.date > nowInBerlin(now).date) throw new ServiceError(400, 'attendance_future')
  const rules = ifsgRulesFor(db, viewer.facilityId)
  checkedCaseRule(rules, input.disease, input.kind, input.ruleVariant, [input.date, input.onsetDate, input.ruleDate])
  if (input.onsetDate > input.date) throw new ServiceError(400, 'invalid_date')
  const child = loadChild(db, viewer.facilityId, input.childId)
  if (childStatus(child, input.date) !== 'active') throw new ServiceError(404, 'child_not_found')
  const groupId = groupOnDay(groupHistories(db, viewer.facilityId).get(input.childId) ?? [], input.date)
  if (!seesIfsgDisease(viewer, groupId)) throw new ServiceError(403, 'group_read_only')
  const open = db.select({ id: childIfsgCases.id }).from(childIfsgCases)
    .where(and(eq(childIfsgCases.childId, input.childId), eq(childIfsgCases.disease, input.disease),
      isNull(childIfsgCases.readmittedOn), eq(childIfsgCases.ended, false))).get()
  if (open) throw new ServiceError(409, 'ifsg_case_open')
  return db.transaction((tx) => {
    setAbsence(tx, viewer, {
      childId: input.childId, from: input.date, to: input.date, kind: input.kind === 'sick' ? 'sick' : 'excused',
    }, now)
    return tx.insert(childIfsgCases).values({
      childId: input.childId, facilityId: viewer.facilityId, disease: input.disease, kind: input.kind, reportedOn: input.date,
      onsetDate: input.onsetDate, ruleVariant: input.ruleVariant, ruleDate: input.ruleDate, createdByUserId: viewer.id,
      createdByName: viewer.name, createdAt: now.toISOString(),
    }).returning({ id: childIfsgCases.id }).get().id
  })
}
