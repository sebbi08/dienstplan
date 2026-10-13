import { and, eq, isNull } from 'drizzle-orm'
import { parseCellKey } from '../../shared/domain/cells'
import { isValidIsoDate, parseIsoDate } from '../../shared/domain/dates'
import { ownEntries } from '../../shared/domain/releaseDiff'
import type { IsoDate } from '../../shared/domain/types'
import type { NoteField, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { rebookHomeClosure } from './closureBooking'
import { cellOwner, describeCellAt, dropStaleSickLeave, logReplacedClosureDay, setDayNote, takeClosureDay } from './entries'
import { groupNames } from './groups'
import { ownCellFilter } from './queries'
import { loadReleases } from './release'

type RevertTarget = { type: 'cell'; employeeId: number; date: IsoDate } | { type: 'note'; field: NoteField; date: IsoDate }

function parseKey(key: string, year: number, month: number): RevertTarget {
  const [prefix, date] = key.split('|')
  const inMonth = date !== undefined && isValidIsoDate(date)
    && parseIsoDate(date).year === year && parseIsoDate(date).month === month
  if (!inMonth) throw new ServiceError(400, 'invalid_key')
  if (prefix === 'info1' || prefix === 'info2') return { type: 'note', field: prefix, date }
  const cell = parseCellKey(key)
  if (!Number.isInteger(cell.employeeId) || cell.employeeId <= 0) throw new ServiceError(400, 'invalid_key')
  return { type: 'cell', employeeId: cell.employeeId, date }
}

/**
 * Resets the given cells / info fields (cellKey or noteKey) of a facility's month to its newest release. Cells that are
 * not the facility's own (other facilities' staff, someone who moved away, days before someone moved in) are skipped
 * and stay as they are. Only this plan's entries are reset: help-elsewhere markers are neither deleted nor restored, a
 * helper's cell gets back the entries planned here, and a cell whose day now belongs to another plan (a help-out
 * elsewhere, or the home facility's absence over a help-out) is skipped. A helper's day holding only closure bookings of
 * the home facility gives way to the restored entries; a helper's day reset to empty gets the home closure booked
 * again. Entries get back their released group unless that group was deleted since. A cell reset to a day without
 * working time loses its "Im Dienst erkrankt" marker. Returns the number of reverted keys.
 */
export function revertToRelease(
  db: Db, actor: SessionUser, facilityId: number, year: number, month: number, keys: string[], now: Date = new Date(),
): number {
  const latest = loadReleases(db, facilityId, year, month).at(-1)
  if (!latest) throw new ServiceError(400, 'month_not_released')
  const targets = [...new Set(keys)].map(key => parseKey(key, year, month))
  const templateIds = new Set(db.select({ id: shiftTemplates.id }).from(shiftTemplates)
    .where(eq(shiftTemplates.facilityId, facilityId)).all().map(row => row.id))
  // Released entry groups are the facility's groups (a helper's entries here count for this plan's groups).
  const names = groupNames(db, facilityId)
  const ownsCell = ownCellFilter(db, facilityId)
  const staffIds = new Set(db.select({ id: employees.id }).from(employees).where(eq(employees.facilityId, facilityId)).all()
    .map(row => row.id))
  const released = ownEntries(facilityId, latest.data.entries)
  const timestamp = now.toISOString()
  let reverted = 0

  db.transaction((tx) => {
    for (const target of targets) {
      if (target.type === 'note') {
        const released = latest.data.days.find(day => day.date === target.date)?.[target.field] ?? ''
        setDayNote(tx, actor, facilityId, target.date, target.field, released, now)
        reverted++
        continue
      }
      // Never reset (and so delete) cells of someone who moved away or from before someone moved in.
      if (!ownsCell(target.employeeId, target.date)) continue
      const cell = { employeeId: target.employeeId, date: target.date }
      // Staff cells hold home entries; a helper's cell holds the entries planned in this facility.
      const helpFacilityId = staffIds.has(cell.employeeId) ? null : facilityId
      const owner = cellOwner(tx, cell.employeeId, cell.date)
      const ownedHere = owner === null || (helpFacilityId === null ? owner === 'home' : owner === facilityId)
      const restored = released.filter(e => e.employeeId === cell.employeeId && e.date === cell.date)
      // Nothing is ever deleted from, or restored over, another plan; only the home facility's closure booking gives
      // way to a helper's restored entries, as when they are written.
      const replacedHome = !ownedHere && helpFacilityId !== null && owner === 'home' && restored.length > 0
        ? takeClosureDay(tx, cell)
        : null
      if (!ownedHere && !replacedHome) continue
      reverted++
      const before = replacedHome ? '—' : describeCellAt(tx, cell, names)
      tx.delete(entries).where(and(
        eq(entries.employeeId, cell.employeeId), eq(entries.date, cell.date),
        helpFacilityId === null ? isNull(entries.helpFacilityId) : eq(entries.helpFacilityId, helpFacilityId),
      )).run()
      for (const entry of restored) {
        tx.insert(entries).values({
          employeeId: cell.employeeId, date: cell.date, kind: entry.kind, helpFacilityId,
          shiftTemplateId: entry.templateId !== null && templateIds.has(entry.templateId) ? entry.templateId : null,
          absenceCodeId: entry.codeId, start: entry.start, end: entry.end,
          breakStart: entry.breakStart, breakEnd: entry.breakEnd, countsAsStaff: entry.countsAsStaff,
          note: entry.note, groupId: entry.groupId != null && entry.groupId in names ? entry.groupId : null,
          closureId: null, updatedAt: timestamp, updatedBy: actor.id,
        }).run()
      }
      logChange(tx, { facilityId, ...cell, field: 'entry', before, after: describeCellAt(tx, cell, names), actorId: actor.id, now: timestamp })
      if (replacedHome) logReplacedClosureDay(tx, actor, cell, replacedHome, timestamp)
      // A help-out day reset to empty gets back the home facility's closure.
      if (helpFacilityId !== null && owner === facilityId) rebookHomeClosure(tx, actor, cell.employeeId, cell.date, timestamp)
      dropStaleSickLeave(tx, cell)
    }
  })
  return reverted
}
