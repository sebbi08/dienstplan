import { asc, eq, inArray } from 'drizzle-orm'
import {
  forAllGroups, scopeOf, type DocumentScope, type ItemTargets,
} from '../../shared/domain/documentTargets'
import type { DocumentGroupTarget, DocumentTargetOptionsDto, DocumentTargetsDto, DocumentTargetsInput, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  contactTargetGroups, contactTargets, employees, facilities, groups, knowledgeEntryTargetGroups, knowledgeEntryTargets, printTemplateTargetGroups, printTemplateTargets,
} from '../db/schema'
import { ServiceError } from '../lib/errors'
import { tabletUnlockStatus } from './tabletUnlock'

/**
 * „Gilt für“ of Vorlagen, „Wissen“ entries and Kontakte as stored (print_template_targets / knowledge_entry_targets /
 * contact_targets and their group tables; the rules are in shared/domain/documentTargets.ts): reading them for many items
 * at once, checking what an editor chose, and writing it.
 */
export type TargetKind = 'template' | 'knowledge' | 'contact'

/** The rows of „Gilt für“ of the items of the kind: per facility, and the groups (with their facility). */
function targetRows(db: Db, kind: TargetKind, ids: number[]) {
  switch (kind) {
    case 'template': return {
      facilities: db.select({ itemId: printTemplateTargets.templateId, facilityId: printTemplateTargets.facilityId, allGroups: printTemplateTargets.allGroups })
        .from(printTemplateTargets).where(inArray(printTemplateTargets.templateId, ids)).all(),
      groups: db.select({ itemId: printTemplateTargetGroups.templateId, groupId: groups.id, facilityId: groups.facilityId })
        .from(printTemplateTargetGroups).innerJoin(groups, eq(groups.id, printTemplateTargetGroups.groupId))
        .where(inArray(printTemplateTargetGroups.templateId, ids)).all(),
    }
    case 'knowledge': return {
      facilities: db.select({ itemId: knowledgeEntryTargets.entryId, facilityId: knowledgeEntryTargets.facilityId, allGroups: knowledgeEntryTargets.allGroups })
        .from(knowledgeEntryTargets).where(inArray(knowledgeEntryTargets.entryId, ids)).all(),
      groups: db.select({ itemId: knowledgeEntryTargetGroups.entryId, groupId: groups.id, facilityId: groups.facilityId })
        .from(knowledgeEntryTargetGroups).innerJoin(groups, eq(groups.id, knowledgeEntryTargetGroups.groupId))
        .where(inArray(knowledgeEntryTargetGroups.entryId, ids)).all(),
    }
    case 'contact': return {
      facilities: db.select({ itemId: contactTargets.contactId, facilityId: contactTargets.facilityId, allGroups: contactTargets.allGroups })
        .from(contactTargets).where(inArray(contactTargets.contactId, ids)).all(),
      groups: db.select({ itemId: contactTargetGroups.contactId, groupId: groups.id, facilityId: groups.facilityId })
        .from(contactTargetGroups).innerJoin(groups, eq(groups.id, contactTargetGroups.groupId))
        .where(inArray(contactTargetGroups.contactId, ids)).all(),
    }
  }
}

/** „Gilt für“ as checked, ready to be written. */
export interface CheckedTargets {
  scope: DocumentScope
  allFacilities: boolean
  /** The target rows: every facility of a scope other than 'all', and for 'all' the facilities limited to groups. */
  rows: { facilityId: number; allGroups: boolean }[]
  groupIds: number[]
}

const NO_TARGETS: ItemTargets = { allFacilities: false, facilities: new Map(), groups: new Map() }

/** The targets of the items (`allFacilities` from the item rows), by item id; an item without rows gets none. */
export function loadTargets(db: Db, kind: TargetKind, items: readonly { id: number; allFacilities: boolean }[]): Map<number, ItemTargets> {
  const ids = items.map(item => item.id)
  const { facilities: facilityRows, groups: groupRows } = ids.length === 0 ? { facilities: [], groups: [] } : targetRows(db, kind, ids)
  const result = new Map<number, { allFacilities: boolean; facilities: Map<number, boolean>; groups: Map<number, Set<number>> }>()
  for (const item of items) result.set(item.id, { allFacilities: item.allFacilities, facilities: new Map(), groups: new Map() })
  for (const row of facilityRows) result.get(row.itemId)?.facilities.set(row.facilityId, row.allGroups)
  for (const row of groupRows) {
    const targets = result.get(row.itemId)
    if (!targets) continue
    if (!targets.groups.has(row.facilityId)) targets.groups.set(row.facilityId, new Set())
    targets.groups.get(row.facilityId)!.add(row.groupId)
  }
  return result
}

/** The targets of one item. */
export const targetsOf = (db: Db, kind: TargetKind, item: { id: number; allFacilities: boolean }): ItemTargets =>
  loadTargets(db, kind, [item]).get(item.id) ?? NO_TARGETS

/** The facilities the item shows in: its own, every facility, or the ones chosen. */
export function facilitiesInScope(db: Db, item: { facilityId: number | null }, targets: ItemTargets): number[] {
  if (item.facilityId !== null) return [item.facilityId]
  if (targets.allFacilities) return db.select({ id: facilities.id }).from(facilities).all().map(row => row.id)
  return [...targets.facilities.keys()]
}

const invalid = () => new ServiceError(400, 'document_targets_invalid')

/**
 * The checked „Gilt für“: for a facility's own item (`owner` set) just that facility; for 'all' every facility; for
 * 'selected' the facilities named (at least one, else 400 document_targets_no_facility; each existing). Groups only for
 * facilities in the scope, at least one per limited facility (else 400 document_targets_no_group), each a group of that
 * facility. Anything else is 400 document_targets_invalid.
 */
export function checkedTargets(db: Db, scope: DocumentScope, owner: number | null, input: DocumentTargetsInput): CheckedTargets {
  const allFacilityIds = new Set(db.select({ id: facilities.id }).from(facilities).all().map(row => row.id))
  let inScope: Set<number>
  if (scope === 'facility') {
    if (owner === null) throw invalid()
    inScope = new Set([owner])
  }
  else if (scope === 'all') inScope = allFacilityIds
  else {
    const ids = input.facilityIds ?? []
    // None chosen (also an item whose chosen facilities are all gone, saved as it is): a message of its own.
    if (ids.length === 0) throw new ServiceError(400, 'document_targets_no_facility')
    if (new Set(ids).size !== ids.length || !ids.every(id => allFacilityIds.has(id))) throw invalid()
    inScope = new Set(ids)
  }
  const limited = new Map<number, number[]>()
  for (const target of input.groupTargets ?? []) {
    if (!inScope.has(target.facilityId) || limited.has(target.facilityId)) throw invalid()
    // Limited to groups that are all gone (saved as it is): a message of its own; never widened to all groups unasked.
    if (target.groupIds.length === 0) throw new ServiceError(400, 'document_targets_no_group')
    limited.set(target.facilityId, target.groupIds)
  }
  const groupIds = [...limited.values()].flat()
  if (new Set(groupIds).size !== groupIds.length) throw invalid()
  if (groupIds.length > 0) {
    const facilityOf = new Map(db.select({ id: groups.id, facilityId: groups.facilityId }).from(groups).where(inArray(groups.id, groupIds)).all()
      .map(row => [row.id, row.facilityId]))
    for (const [facilityId, ids] of limited) {
      if (!ids.every(id => facilityOf.get(id) === facilityId)) throw invalid()
    }
  }
  const rows = scope === 'all'
    ? [...limited.keys()].map(facilityId => ({ facilityId, allGroups: false }))
    : [...inScope].map(facilityId => ({ facilityId, allGroups: !limited.has(facilityId) }))
  return { scope, allFacilities: scope === 'all', rows, groupIds }
}

/** The current „Gilt für“ of an item as input (to keep it when a change does not name one, or to compare). */
export function targetsInput(item: { facilityId: number | null }, targets: ItemTargets): Required<DocumentTargetsInput> {
  return {
    scope: scopeOf(item, targets),
    facilityIds: item.facilityId !== null || targets.allFacilities ? [] : [...targets.facilities.keys()],
    groupTargets: [...targets.facilities].filter(([, allGroups]) => !allGroups)
      .map(([facilityId]) => ({ facilityId, groupIds: [...targets.groups.get(facilityId) ?? []] })),
  }
}

/** Replaces the item's target rows and groups (the caller sets `allFacilities` on the item). Inside the caller's transaction. */
export function writeTargets(db: Db, kind: TargetKind, itemId: number, targets: CheckedTargets): void {
  if (kind === 'template') {
    db.delete(printTemplateTargets).where(eq(printTemplateTargets.templateId, itemId)).run()
    db.delete(printTemplateTargetGroups).where(eq(printTemplateTargetGroups.templateId, itemId)).run()
    for (const row of targets.rows) db.insert(printTemplateTargets).values({ templateId: itemId, ...row }).run()
    for (const groupId of targets.groupIds) db.insert(printTemplateTargetGroups).values({ templateId: itemId, groupId }).run()
    return
  }
  if (kind === 'contact') {
    db.delete(contactTargets).where(eq(contactTargets.contactId, itemId)).run()
    db.delete(contactTargetGroups).where(eq(contactTargetGroups.contactId, itemId)).run()
    for (const row of targets.rows) db.insert(contactTargets).values({ contactId: itemId, ...row }).run()
    for (const groupId of targets.groupIds) db.insert(contactTargetGroups).values({ contactId: itemId, groupId }).run()
    return
  }
  db.delete(knowledgeEntryTargets).where(eq(knowledgeEntryTargets.entryId, itemId)).run()
  db.delete(knowledgeEntryTargetGroups).where(eq(knowledgeEntryTargetGroups.entryId, itemId)).run()
  for (const row of targets.rows) db.insert(knowledgeEntryTargets).values({ entryId: itemId, ...row }).run()
  for (const groupId of targets.groupIds) db.insert(knowledgeEntryTargetGroups).values({ entryId: itemId, groupId }).run()
}

/** The home group of the employee (their group in the plan), null without one or without an employee. */
export function homeGroupOf(db: Db, employeeId: number | null | undefined): number | null {
  if (employeeId == null) return null
  return db.select({ groupId: employees.groupId }).from(employees).where(eq(employees.id, employeeId)).get()?.groupId ?? null
}

/**
 * The home group of whoever reads: an account its linked employee's group; the facility's tablet the group of the person
 * who unlocked it with `token` (checked without counting as use), none while it is locked.
 */
export function readerHomeGroup(
  db: Db, user: Pick<SessionUser, 'id' | 'role' | 'employeeId' | 'facilityId'>, token: string | undefined, now: Date = new Date(),
): number | null {
  if (user.role !== 'terminal') return homeGroupOf(db, user.employeeId)
  if (user.facilityId === null) return null
  const status = tabletUnlockStatus(db, { id: user.id, facilityId: user.facilityId }, token, now)
  return status.unlocked ? homeGroupOf(db, status.employeeId) : null
}

/**
 * The names for the hints and the editor (facilities and groups by id), loaded once per list.
 */
export function targetNames(db: Db): { facilities: Map<number, string>; groups: Map<number, string> } {
  return {
    facilities: new Map(db.select({ id: facilities.id, name: facilities.name }).from(facilities).all().map(row => [row.id, row.name])),
    groups: new Map(db.select({ id: groups.id, name: groups.name }).from(groups).all().map(row => [row.id, row.name])),
  }
}

/**
 * „Gilt für“ of an item as the lists show it to Leitung, Träger and whoever may change it, with the hints for the
 * facility looked at. Only who may change the item (`full`) gets the chosen facility ids and the groups of other
 * facilities; everyone else the facility names for the hint and the groups of the facility looked at.
 */
export function targetsDto(
  item: { facilityId: number | null }, targets: ItemTargets, facilityId: number, names: ReturnType<typeof targetNames>, full: boolean,
): DocumentTargetsDto {
  const input = targetsInput(item, targets)
  const chosen = input.scope === 'facility' ? [item.facilityId!] : input.facilityIds
  const byName = (a: string, b: string) => a.localeCompare(b, 'de')
  const groupTargets: DocumentGroupTarget[] = full ? input.groupTargets : input.groupTargets.filter(target => target.facilityId === facilityId)
  return {
    scope: input.scope,
    facilityIds: full ? chosen : chosen.filter(id => id === facilityId),
    facilityNames: input.scope === 'selected' ? chosen.map(id => names.facilities.get(id) ?? '').sort(byName) : [],
    groupTargets,
    groupNames: forAllGroups(targets, facilityId)
      ? null
      : [...targets.groups.get(facilityId) ?? []].map(id => names.groups.get(id) ?? '').sort(byName),
  }
}

/**
 * What „Gilt für“ offers: with the Träger's right (`global`) every facility with its groups, otherwise the editor's own
 * facility with its groups; each in the usual order.
 */
export function targetOptions(db: Db, facilityId: number, global: boolean): DocumentTargetOptionsDto {
  const facilityRows = db.select({ id: facilities.id, name: facilities.name }).from(facilities).orderBy(asc(facilities.id)).all()
    .filter(row => global || row.id === facilityId)
  const groupRows = db.select({ id: groups.id, name: groups.name, facilityId: groups.facilityId }).from(groups)
    .orderBy(asc(groups.sortOrder), asc(groups.id)).all()
  return {
    facilityId,
    facilities: facilityRows.map(row => ({
      id: row.id, name: row.name,
      groups: groupRows.filter(group => group.facilityId === row.id).map(group => ({ id: group.id, name: group.name })),
    })),
  }
}
