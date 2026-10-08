import { cellKey } from '#shared/domain/cells'
import { isTargetGapCode } from '#shared/domain/warnings'
import type { CellRef, CodeDto, EntryDto, MonthPlanDto } from '#shared/types/api'

/**
 * What may be entered into the selected cells:
 * - 'normal': everything;
 * - 'helper': a helper's cells are among them, so no absences (their home facility enters those);
 * - 'marker': a day on which someone helps out elsewhere is among them, so only absences (they replace the help-out);
 * - 'mixed': both, so nothing fits all of them.
 */
export type CellScope = 'normal' | 'helper' | 'marker' | 'mixed'

/** An entry of the plan's own staff that was planned in another facility ("Aushilfe in …", read-only here). */
export function isMarker(entry: EntryDto, facilityId: number): boolean {
  return entry.helpFacilityId !== null && entry.helpFacilityId !== facilityId
}

/** Keys of the cells that show a help-out in another facility. */
export function markerCellKeys(plan: MonthPlanDto): Set<string> {
  return new Set(plan.entries.filter(entry => isMarker(entry, plan.facilityId)).map(entry => cellKey(entry.employeeId, entry.date)))
}

/** Keys of the helper cells that belong to another plan ("belegt"). */
export function busyCellKeys(plan: MonthPlanDto): Set<string> {
  return new Set(Object.entries(plan.admin?.helperBusy ?? {})
    .flatMap(([employeeId, dates]) => dates.map(date => cellKey(Number(employeeId), date))))
}

export function cellScope(plan: MonthPlanDto, cells: CellRef[]): CellScope {
  const helperIds = new Set(plan.employees.filter(employee => employee.helpFrom).map(employee => employee.id))
  const markers = markerCellKeys(plan)
  const hasHelper = cells.some(cell => helperIds.has(cell.employeeId))
  const hasMarker = cells.some(cell => markers.has(cellKey(cell.employeeId, cell.date)))
  if (hasHelper && hasMarker) return 'mixed'
  return hasHelper ? 'helper' : hasMarker ? 'marker' : 'normal'
}

/** The codes that may be entered for the scope (the button codes are filtered further by the caller). */
export function codesForScope(codes: CodeDto[], scope: CellScope): CodeDto[] {
  if (scope === 'helper') return codes.filter(code => isTargetGapCode(code.key))
  if (scope === 'marker') return codes.filter(code => !isTargetGapCode(code.key))
  return scope === 'mixed' ? [] : codes
}
