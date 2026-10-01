import { and, eq } from 'drizzle-orm'
import { parseCellKey } from '../../shared/domain/cells'
import { isValidIsoDate, parseIsoDate } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import type { NoteField, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { describeCellAt, setDayNote } from './entries'
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
 * Resets the given cells / info fields (cellKey or noteKey) of a month to the newest release.
 * Returns the number of reverted keys.
 */
export function revertToRelease(
  db: Db, actor: SessionUser, year: number, month: number, keys: string[], now: Date = new Date(),
): number {
  const latest = loadReleases(db, year, month).at(-1)
  if (!latest) throw new ServiceError(400, 'month_not_released')
  const targets = [...new Set(keys)].map(key => parseKey(key, year, month))
  const templateIds = new Set(db.select({ id: shiftTemplates.id }).from(shiftTemplates).all().map(row => row.id))
  const employeeIds = new Set(db.select({ id: employees.id }).from(employees).all().map(row => row.id))
  const timestamp = now.toISOString()

  db.transaction((tx) => {
    for (const target of targets) {
      if (target.type === 'note') {
        const released = latest.data.days.find(day => day.date === target.date)?.[target.field] ?? ''
        setDayNote(tx, actor, target.date, target.field, released, now)
        continue
      }
      if (!employeeIds.has(target.employeeId)) throw new ServiceError(400, 'employee_not_found')
      const cell = { employeeId: target.employeeId, date: target.date }
      const before = describeCellAt(tx, cell)
      tx.delete(entries).where(and(eq(entries.employeeId, cell.employeeId), eq(entries.date, cell.date))).run()
      for (const entry of latest.data.entries.filter(e => e.employeeId === cell.employeeId && e.date === cell.date)) {
        tx.insert(entries).values({
          employeeId: cell.employeeId, date: cell.date, kind: entry.kind,
          shiftTemplateId: entry.templateId !== null && templateIds.has(entry.templateId) ? entry.templateId : null,
          absenceCodeId: entry.codeId, start: entry.start, end: entry.end,
          breakStart: entry.breakStart, breakEnd: entry.breakEnd, countsAsStaff: entry.countsAsStaff,
          note: entry.note, closureId: null, updatedAt: timestamp, updatedBy: actor.id,
        }).run()
      }
      logChange(tx, { ...cell, field: 'entry', before, after: describeCellAt(tx, cell), actorId: actor.id, now: timestamp })
    }
  })
  return targets.length
}
