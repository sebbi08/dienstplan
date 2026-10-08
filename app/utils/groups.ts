import type { EmployeeColumnDto, MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** A block of plan columns: one group (with its "anwesend" column), the Springer, or the helpers of other facilities. */
export interface PlanBlock {
  key: string
  /** Shown above the block's columns; null without groups (no block header at all). */
  label: string | null
  employees: EmployeeColumnDto[]
  /** The group whose attendance column closes the block (null for Springer, helpers and plans without groups). */
  groupId: number | null
}

/** The group chosen in the select, if the plan has it (otherwise everything is shown). */
export function shownGroup(plan: MonthPlanDto, groupId: number | null | undefined): number | null {
  return groupId != null && plan.groups.some(group => group.id === groupId) ? groupId : null
}

/**
 * The plan's columns in blocks: each group in its order (also one without members, which then has only its attendance
 * column), then the Springer, then the helpers. Without groups (also for releases from before groups) one block
 * without a label, so the plan looks as it always did. A home group the plan does not know counts as Springer.
 * With a chosen group (the select above the plan) only its block is left, plus the Springer and helpers.
 */
export function planBlocks(plan: MonthPlanDto, groupId: number | null = null): PlanBlock[] {
  if (plan.groups.length === 0) return [{ key: 'all', label: null, employees: plan.employees, groupId: null }]
  const chosen = shownGroup(plan, groupId)
  const known = new Set(plan.groups.map(group => group.id))
  const helpers = plan.employees.filter(employee => employee.helpFrom)
  const staff = plan.employees.filter(employee => !employee.helpFrom)
  const blocks: PlanBlock[] = plan.groups.filter(group => chosen === null || group.id === chosen).map(group => ({
    key: `group-${group.id}`, label: group.name, groupId: group.id,
    employees: staff.filter(employee => employee.groupId === group.id),
  }))
  const springer = staff.filter(employee => employee.groupId == null || !known.has(employee.groupId))
  if (springer.length) blocks.push({ key: 'springer', label: de.groups.springer, employees: springer, groupId: null })
  if (helpers.length) blocks.push({ key: 'helpers', label: de.groups.helpers, employees: helpers, groupId: null })
  return blocks
}

/** The people shown with the chosen group, in the order of the plan's columns. */
export function shownEmployees(plan: MonthPlanDto, groupId: number | null): EmployeeColumnDto[] {
  return planBlocks(plan, groupId).flatMap(block => block.employees)
}

const FILTER_KEY = 'dienstplan.planGroup'

/** The group chosen in the plan's select, remembered per browser (storage may be unavailable: then nothing is kept). */
export function readGroupFilter(): number | null {
  try {
    const value = Number(localStorage.getItem(FILTER_KEY))
    return Number.isInteger(value) && value > 0 ? value : null
  }
  catch {
    return null
  }
}

export function writeGroupFilter(groupId: number | null): void {
  try {
    if (groupId === null) localStorage.removeItem(FILTER_KEY)
    else localStorage.setItem(FILTER_KEY, String(groupId))
  }
  catch {
    // Not remembered; the select still works on this page.
  }
}
