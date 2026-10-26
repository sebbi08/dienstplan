import { randomUUID } from 'node:crypto'
import { and, count, eq, max } from 'drizzle-orm'
import { checkContent, FORM_KINDS, FORM_LIMITS, FormError, type FormContent, type FormKind } from '../../shared/domain/forms'
import { STAFF_STARTERS, starterContent } from '../../shared/domain/forms/starters'
import type { FormTemplateDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, forms, formTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'

export type FormTemplateRow = typeof formTemplates.$inferSelect

export interface FormTemplateInput {
  kind: FormKind
  name: string
  selfAssessment: boolean
}

/** Any subset of the template's fields; `content` is the whole content as the editor holds it (new parts without ids). */
export interface FormTemplateUpdate {
  name?: string
  archived?: boolean
  selfAssessment?: boolean
  content?: unknown
}

const NOT_FOUND_CODES = new Set(['form_section_not_found', 'form_item_not_found'])

/** Runs domain code and turns its FormError into a ServiceError (unknown section / item 404, everything else 400). */
export function withFormErrors<T>(run: () => T): T {
  try {
    return run()
  }
  catch (error) {
    if (error instanceof FormError) throw new ServiceError(NOT_FOUND_CODES.has(error.code) ? 404 : 400, error.code)
    throw error
  }
}

/** The name kept with a change: the linked employee's, else the username (stays when the account goes). */
export function actorName(db: Db, user: SessionUser): string {
  if (user.employeeId === null) return user.username
  return db.select({ name: employees.name }).from(employees).where(eq(employees.id, user.employeeId)).get()?.name ?? user.username
}

/** A template of the facility; another facility's template is 404 form_template_not_found (no existence leak). */
export function loadTemplate(db: Db, facilityId: number, id: number): FormTemplateRow {
  const row = db.select().from(formTemplates).where(and(eq(formTemplates.id, id), eq(formTemplates.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'form_template_not_found')
  return row
}

/** The stored content (written only through checkContent). */
export function templateContent(row: Pick<FormTemplateRow, 'content'>): FormContent {
  return JSON.parse(row.content) as FormContent
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const lacksId = (value: Record<string, unknown>) => value.id === undefined || value.id === null || value.id === ''

/**
 * The editor's content with an id for every section, item and choice option that has none yet (kept ids stay).
 * Anything that is not shaped like content is passed on unchanged for checkContent to reject.
 */
export function withIds(content: unknown, newId: () => string = randomUUID): unknown {
  if (!isObject(content) || !Array.isArray(content.sections)) return content
  const withId = (value: Record<string, unknown>) => (lacksId(value) ? { ...value, id: newId() } : value)
  return {
    ...content,
    sections: content.sections.map((section: unknown) => {
      if (!isObject(section)) return section
      return {
        ...withId(section),
        items: Array.isArray(section.items)
          ? section.items.map((item: unknown) => {
              if (!isObject(item)) return item
              const options = item.kind === 'choices' && Array.isArray(item.options)
                ? { options: item.options.map((option: unknown) => (isObject(option) ? withId(option) : option)) }
                : {}
              return { ...withId(item), ...options }
            })
          : section.items,
      }
    }),
  }
}

/** The same content with new ids throughout (for a copy). */
function freshIds(content: FormContent, newId: () => string): FormContent {
  return {
    sections: content.sections.map(section => ({
      ...section,
      id: newId(),
      items: section.items.map(item => (item.kind === 'choices'
        ? { ...item, id: newId(), options: item.options.map(option => ({ ...option, id: newId() })) }
        : { ...item, id: newId() })),
    })),
  }
}

function existingNames(db: Db, facilityId: number, kind: FormKind) {
  return db.select({ id: formTemplates.id, name: formTemplates.name }).from(formTemplates)
    .where(and(eq(formTemplates.facilityId, facilityId), eq(formTemplates.kind, kind))).all()
}

/** Trimmed name (1–80 chars), unique among the facility's templates of the kind regardless of case. */
function checkedName(db: Db, facilityId: number, kind: FormKind, name: string, exceptId: number | null): string {
  const checked = uniqueName(existingNames(db, facilityId, kind), name, exceptId, {
    required: 'form_template_name_required', taken: 'form_template_name_taken',
  })
  if (checked.length > FORM_LIMITS.templateName) throw new ServiceError(400, 'form_template_name_too_long')
  return checked
}

function assertKind(kind: string): asserts kind is FormKind {
  if (!(FORM_KINDS as readonly string[]).includes(kind)) throw new ServiceError(400, 'form_kind_invalid')
}

function nextSortOrder(db: Db, facilityId: number, kind: FormKind): number {
  const row = db.select({ value: max(formTemplates.sortOrder) }).from(formTemplates)
    .where(and(eq(formTemplates.facilityId, facilityId), eq(formTemplates.kind, kind))).get()
  return (row?.value ?? -1) + 1
}

function toDto(row: FormTemplateRow, inUse: boolean): FormTemplateDto {
  return {
    id: row.id, kind: row.kind, name: row.name, starterKey: row.starterKey, selfAssessment: row.selfAssessment,
    archived: row.archived, sortOrder: row.sortOrder, content: templateContent(row), updatedAt: row.updatedAt,
    updatedBy: row.updatedBy, inUse,
  }
}

/** The facility's templates (of one kind, or all): active before archived, then by kind and order. */
export function listTemplates(db: Db, facilityId: number, kind?: FormKind): FormTemplateDto[] {
  const rows = db.select().from(formTemplates).where(and(
    eq(formTemplates.facilityId, facilityId), kind === undefined ? undefined : eq(formTemplates.kind, kind),
  )).all()
  const used = new Set(db.selectDistinct({ templateId: forms.templateId }).from(forms)
    .where(eq(forms.facilityId, facilityId)).all().map(row => row.templateId))
  return rows
    .sort((a, b) => Number(a.archived) - Number(b.archived) || FORM_KINDS.indexOf(a.kind) - FORM_KINDS.indexOf(b.kind)
      || a.sortOrder - b.sortOrder || a.id - b.id)
    .map(row => toDto(row, used.has(row.id)))
}

/** A new, empty template at the end of its kind; returns its id. Only staff templates can be self-assessments. */
export function createTemplate(db: Db, actor: SessionUser, facilityId: number, input: FormTemplateInput, now: Date = new Date()): number {
  assertKind(input.kind)
  const name = checkedName(db, facilityId, input.kind, input.name, null)
  const at = now.toISOString()
  return db.insert(formTemplates).values({
    facilityId, kind: input.kind, name, selfAssessment: input.kind === 'staff' && input.selfAssessment,
    sortOrder: nextSortOrder(db, facilityId, input.kind), content: JSON.stringify({ sections: [] }),
    createdAt: at, updatedAt: at, updatedBy: actorName(db, actor),
  }).returning({ id: formTemplates.id }).get().id
}

/** 400 form_item_kind_fixed when an item keeps its id but not its kind (delete it and add a new one instead). */
function assertKindsKept(before: FormContent, after: FormContent): void {
  const kinds = new Map(before.sections.flatMap(section => section.items.map(item => [item.id, item.kind] as const)))
  for (const item of after.sections.flatMap(section => section.items)) {
    const kind = kinds.get(item.id)
    if (kind !== undefined && kind !== item.kind) throw new FormError('form_item_kind_fixed')
  }
}

/**
 * Renames, archives / reactivates, marks as self-assessment or replaces the content (checked with checkContent,
 * texts trimmed, missing ids added, kinds of kept items unchanged). Existing forms keep their own copy of the content.
 * When nothing changes, nothing is written (the last change stays as it was).
 */
export function updateTemplate(
  db: Db, actor: SessionUser, facilityId: number, id: number, input: FormTemplateUpdate, now: Date = new Date(),
): void {
  const row = loadTemplate(db, facilityId, id)
  const values: Partial<typeof formTemplates.$inferInsert> = {}
  if (input.name !== undefined) {
    const name = checkedName(db, facilityId, row.kind, input.name, id)
    if (name !== row.name) values.name = name
  }
  if (input.archived !== undefined && input.archived !== row.archived) values.archived = input.archived
  if (input.selfAssessment !== undefined) {
    const selfAssessment = row.kind === 'staff' && input.selfAssessment
    if (selfAssessment !== row.selfAssessment) values.selfAssessment = selfAssessment
  }
  if (input.content !== undefined) {
    const raw = input.content
    const content = withFormErrors(() => {
      const checked = checkContent(withIds(raw))
      assertKindsKept(templateContent(row), checked)
      return JSON.stringify(checked)
    })
    if (content !== row.content) values.content = content
  }
  if (Object.keys(values).length === 0) return
  db.update(formTemplates).set({ ...values, updatedAt: now.toISOString(), updatedBy: actorName(db, actor) })
    .where(eq(formTemplates.id, id)).run()
}

/** Deletes a template no form was made from (409 form_template_in_use otherwise: archive it instead). */
export function deleteTemplate(db: Db, facilityId: number, id: number): void {
  loadTemplate(db, facilityId, id)
  const used = db.select({ value: count() }).from(forms).where(eq(forms.templateId, id)).get()!.value > 0
  if (used) throw new ServiceError(409, 'form_template_in_use')
  db.delete(formTemplates).where(eq(formTemplates.id, id)).run()
}

/** „‹Name› (Kopie)“, then „(Kopie 2)“ …, the name shortened so the whole stays within 80 characters. */
function copyName(db: Db, facilityId: number, kind: FormKind, name: string): string {
  const folded = new Set(existingNames(db, facilityId, kind).map(row => row.name.toLocaleLowerCase('de')))
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (Kopie)' : ` (Kopie ${n})`
    const candidate = `${name.slice(0, FORM_LIMITS.templateName - suffix.length).trimEnd()}${suffix}`
    if (!folded.has(candidate.toLocaleLowerCase('de'))) return candidate
  }
}

/** A copy at the end of its kind: same texts and settings, new ids, active, no starter key; returns its id. */
export function copyTemplate(
  db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date(), newId: () => string = randomUUID,
): number {
  const row = loadTemplate(db, facilityId, id)
  const at = now.toISOString()
  return db.insert(formTemplates).values({
    facilityId, kind: row.kind, name: copyName(db, facilityId, row.kind, row.name), selfAssessment: row.selfAssessment,
    sortOrder: nextSortOrder(db, facilityId, row.kind), content: JSON.stringify(freshIds(templateContent(row), newId)),
    createdAt: at, updatedAt: at, updatedBy: actorName(db, actor),
  }).returning({ id: formTemplates.id }).get().id
}

/**
 * Creates the staff starter templates the facility does not have yet (by starter key) and marks the facility as
 * seeded, so a starter deleted later is not created again. Call it inside the caller's transaction.
 */
export function seedStarterTemplates(db: Db, facilityId: number, now: Date = new Date(), newId: () => string = randomUUID): void {
  const present = new Set(db.select({ key: formTemplates.starterKey }).from(formTemplates)
    .where(eq(formTemplates.facilityId, facilityId)).all().map(row => row.key))
  const at = now.toISOString()
  for (const starter of STAFF_STARTERS) {
    if (present.has(starter.key)) continue
    // A template of the facility's own may already use the name; the starter then gets a free one.
    const taken = existingNames(db, facilityId, starter.kind)
      .some(row => row.name.toLocaleLowerCase('de') === starter.name.toLocaleLowerCase('de'))
    db.insert(formTemplates).values({
      facilityId, kind: starter.kind, starterKey: starter.key, selfAssessment: starter.selfAssessment,
      name: taken ? copyName(db, facilityId, starter.kind, starter.name) : starter.name,
      sortOrder: nextSortOrder(db, facilityId, starter.kind),
      content: JSON.stringify(checkContent(starterContent(starter, newId))), createdAt: at, updatedAt: at, updatedBy: '',
    }).run()
  }
  db.update(facilities).set({ formStartersSeeded: true }).where(eq(facilities.id, facilityId)).run()
}

/** Startup step: seeds the starters of every facility not seeded yet (those from before the forms); returns how many. */
export function seedPendingStarterTemplates(db: Db, now: Date = new Date()): number {
  const pending = db.select({ id: facilities.id }).from(facilities).where(eq(facilities.formStartersSeeded, false)).all()
  for (const facility of pending) db.transaction(tx => seedStarterTemplates(tx, facility.id, now))
  return pending.length
}
