import { eq } from 'drizzle-orm'
import { dateRange, daysBetween, isWeekend } from '../../shared/domain/dates'
import { isHoliday } from '../../shared/domain/holidays'
import { isEmployedOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { ClosureDto, ClosureMode, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, entries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { applyToCells, describeCellAt } from './entries'
import { loadClosures, loadEmployees, loadEntries } from './queries'

export interface ClosureInput {
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
}

export function listClosures(db: Db): ClosureDto[] {
  return loadClosures(db)
}

export function createClosure(db: Db, actor: SessionUser, input: ClosureInput, now: Date = new Date()): ClosureDto {
  const label = input.label.trim()
  if (!label) throw new ServiceError(400, 'label_required')
  const length = daysBetween(input.startDate, input.endDate)
  if (length < 0 || length > 366) throw new ServiceError(400, 'invalid_range')
  const code = db.select().from(absenceCodes)
    .where(eq(absenceCodes.key, input.mode === 'vacation' ? 'vacation' : 'closure_day')).get()
  if (!code) throw new ServiceError(500, 'code_not_found')

  return db.transaction((tx) => {
    const closure = tx.insert(closures)
      .values({ startDate: input.startDate, endDate: input.endDate, label, mode: input.mode })
      .returning().get()
    const staff = loadEmployees(tx)
    const cells = dateRange(input.startDate, input.endDate)
      .filter(date => !isWeekend(date) && !isHoliday(date))
      .flatMap(date => staff.filter(employee => isEmployedOn(employee.info, date)).map(employee => ({ employeeId: employee.id, date })))
    applyToCells(tx, actor, cells, 'replace', { kind: 'code', codeId: code.id }, { now, closureId: closure.id })
    return closure
  })
}

export function deleteClosure(db: Db, actor: SessionUser, id: number, now: Date = new Date()): void {
  if (!db.select().from(closures).where(eq(closures.id, id)).get()) throw new ServiceError(404, 'closure_not_found')
  db.transaction((tx) => {
    const cells = loadEntries(tx, { closureId: id }).map(entry => ({ employeeId: entry.employeeId, date: entry.date }))
    const before = cells.map(cell => describeCellAt(tx, cell))
    tx.delete(entries).where(eq(entries.closureId, id)).run()
    cells.forEach((cell, index) => logChange(tx, {
      ...cell, field: 'entry', before: before[index]!, after: describeCellAt(tx, cell),
      actorId: actor.id, now: now.toISOString(),
    }))
    tx.delete(closures).where(eq(closures.id, id)).run()
  })
}
