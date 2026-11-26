import { randomUUID } from 'node:crypto'
import { and, count, eq } from 'drizzle-orm'
import { formCategoryRanks, formCategorySpot, type TemplateChoice } from '../../shared/domain/formCategories'
import {
  checkContent, FORM_KINDS, FORM_LIMITS, FORM_SUBJECTS, FormError, type FormContent, type FormKind, type FormSubject,
} from '../../shared/domain/forms'
import { STARTERS, starterContent, type StarterKey } from '../../shared/domain/forms/starters'
import type { FormTemplateDto, Role, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, forms, formStarterSeeds, formTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'
import { assertFilingConfirmed, chosenFormCategory, exampleCategoryOf, seedFormCategories, seesFormCategory } from './formTemplateCategories'
import { appendEntry } from './printTemplates'
import { facilityCategories } from './templateCategories'

export type FormTemplateRow = typeof formTemplates.$inferSelect

export interface FormTemplateInput {
  kind: FormKind
  name: string
  selfAssessment: boolean
  /** Required for an accident template (whom its forms are about), ignored for the other kinds. */
  subject?: string | null
  /** The facility's category or subcategory (of „Vorlagen“, one the actor sees) to file it in (null or left out = none). */
  categoryId?: number | null
  /** The editor confirmed filing it in a category not everyone sees (else 409 form_category_restricted). */
  confirmRestricted?: boolean
}

/** Any subset of the template's fields; `content` is the whole content as the editor holds it (new parts without ids). */
export interface FormTemplateUpdate {
  name?: string
  archived?: boolean
  selfAssessment?: boolean
  content?: unknown
  /** Another category or subcategory of the facility (null = none); the template goes to the end of that list. */
  categoryId?: number | null
  /** The editor confirmed moving it into a category fewer people see (else 409 form_category_restricted). */
  confirmRestricted?: boolean
  /** The template's updatedAt the editor loaded; when given, a newer save in between is 409 form_template_changed. */
  expectedUpdatedAt?: string
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

/** Who looks at Bögen: the role decides which categories of „Vorlagen“ they see („Wer sieht sie?“). */
export type FormViewer = { role: Role }

/**
 * A template of the facility; another facility's template is 404 form_template_not_found (no existence leak). With a
 * viewer: also one in a category of „Vorlagen“ that the viewer's role does not see („Wer sieht sie?“).
 */
export function loadTemplate(db: Db, facilityId: number, id: number, viewer?: FormViewer): FormTemplateRow {
  const row = db.select().from(formTemplates).where(and(eq(formTemplates.id, id), eq(formTemplates.facilityId, facilityId))).get()
  if (!row || (viewer !== undefined && !seesFormCategory(facilityCategories(db, facilityId), row.categoryId, viewer.role))) {
    throw new ServiceError(404, 'form_template_not_found')
  }
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

/** The subject an accident template needs (400 form_subject_invalid without a valid one); null for the other kinds. */
function checkedSubject(kind: FormKind, subject: unknown): FormSubject | null {
  if (kind !== 'accident') return null
  if (!(FORM_SUBJECTS as readonly unknown[]).includes(subject)) throw new ServiceError(400, 'form_subject_invalid')
  return subject as FormSubject
}

/** Puts the template at the end of its list (its category, among the PDF templates there too; or those without one). */
const toEnd = (db: Db, facilityId: number, id: number) => appendEntry(db, facilityId, { type: 'form', id })

function toDto(row: FormTemplateRow, inUse: boolean, categories: ReturnType<typeof facilityCategories>): FormTemplateDto {
  const spot = formCategorySpot(categories, row.categoryId)
  return {
    id: row.id, kind: row.kind, subject: row.subject, printLayout: row.printLayout, name: row.name, starterKey: row.starterKey, selfAssessment: row.selfAssessment,
    archived: row.archived, sortOrder: row.sortOrder, content: templateContent(row), updatedAt: row.updatedAt,
    updatedBy: row.updatedBy, inUse, categoryId: spot.categoryId, subcategoryId: spot.subcategoryId, category: spot.path,
  }
}

/**
 * The facility's templates (of one kind, or all): active before archived, then by where they are filed (the categories'
 * order, each category followed by its subcategories, those without a category last) and their order there. With
 * a viewer: only those in categories the viewer's role sees („Wer sieht sie?“ of „Vorlagen“).
 */
export function listTemplates(db: Db, facilityId: number, kind?: FormKind, viewer?: FormViewer): FormTemplateDto[] {
  const categories = facilityCategories(db, facilityId)
  const rows = db.select().from(formTemplates).where(and(
    eq(formTemplates.facilityId, facilityId), kind === undefined ? undefined : eq(formTemplates.kind, kind),
  )).all().filter(row => viewer === undefined || seesFormCategory(categories, row.categoryId, viewer.role))
  const used = new Set(db.selectDistinct({ templateId: forms.templateId }).from(forms)
    .where(eq(forms.facilityId, facilityId)).all().map(row => row.templateId))
  const rank = formCategoryRanks(categories)
  return rows
    .sort((a, b) => Number(a.archived) - Number(b.archived) || rank(a.categoryId) - rank(b.categoryId)
      || a.sortOrder - b.sortOrder || FORM_KINDS.indexOf(a.kind) - FORM_KINDS.indexOf(b.kind) || a.id - b.id)
    .map(row => toDto(row, used.has(row.id), categories))
}

/**
 * The active templates of the kind to start a form from (child forms, staff talks, team meetings, accidents, visits)
 * that the viewer's role sees (by the category's „Wer sieht sie?“), in the order of their categories, each with its
 * „Kategorie › Unterkategorie“ for the picker's groups; `only` narrows them further (e.g. the accident templates of one
 * subject).
 */
export function templateChoices(
  db: Db, facilityId: number, kind: FormKind, viewer: FormViewer, only: (template: FormTemplateDto) => boolean = () => true,
): TemplateChoice[] {
  return listTemplates(db, facilityId, kind, viewer).filter(template => !template.archived && only(template))
    .map(template => ({ id: template.id, name: template.name, category: template.category }))
}

/**
 * A new, empty template at the end of its list (the category's, among the PDF templates there too); returns its id. Only
 * staff templates can be self-assessments; an accident template names its subject (child or employee, 400
 * form_subject_invalid otherwise).
 */
export function createTemplate(db: Db, actor: SessionUser, facilityId: number, input: FormTemplateInput, now: Date = new Date()): number {
  assertKind(input.kind)
  const subject = checkedSubject(input.kind, input.subject)
  const name = checkedName(db, facilityId, input.kind, input.name, null)
  const categoryId = chosenFormCategory(db, facilityId, actor.role, input.categoryId ?? null)
  assertFilingConfirmed(db, facilityId, null, categoryId, input.confirmRestricted)
  const at = now.toISOString()
  return db.transaction((tx) => {
    const id = tx.insert(formTemplates).values({
      facilityId, kind: input.kind, subject, name, selfAssessment: input.kind === 'staff' && input.selfAssessment, categoryId,
      content: JSON.stringify({ sections: [] }), createdAt: at, updatedAt: at, updatedBy: actorName(tx, actor),
    }).returning({ id: formTemplates.id }).get().id
    toEnd(tx, facilityId, id)
    return id
  })
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
  const row = loadTemplate(db, facilityId, id, actor)
  const expected = input.expectedUpdatedAt
  if (expected !== undefined && expected !== row.updatedAt) throw new ServiceError(409, 'form_template_changed')
  const values: Partial<typeof formTemplates.$inferInsert> = {}
  if (input.name !== undefined) {
    const name = checkedName(db, facilityId, row.kind, input.name, id)
    if (name !== row.name) values.name = name
  }
  if (input.archived !== undefined && input.archived !== row.archived) values.archived = input.archived
  if (input.categoryId !== undefined) {
    const categoryId = chosenFormCategory(db, facilityId, actor.role, input.categoryId)
    assertFilingConfirmed(db, facilityId, row.categoryId, categoryId, input.confirmRestricted)
    if (categoryId !== row.categoryId) values.categoryId = categoryId
  }
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
  db.transaction((tx) => {
    const result = tx.update(formTemplates).set({ ...values, updatedAt: now.toISOString(), updatedBy: actorName(tx, actor) })
      .where(and(eq(formTemplates.id, id), expected === undefined ? undefined : eq(formTemplates.updatedAt, expected))).run()
    if (result.changes !== 1) throw new ServiceError(409, 'form_template_changed')
    // Filed elsewhere: at the end of the new list.
    if (values.categoryId !== undefined) toEnd(tx, facilityId, id)
  })
}

/**
 * Deletes a template no form was made from (409 form_template_in_use otherwise: archive it instead); with a viewer only
 * one in a category the viewer's role sees.
 */
export function deleteTemplate(db: Db, facilityId: number, id: number, viewer?: FormViewer): void {
  loadTemplate(db, facilityId, id, viewer)
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

/** A copy at the end of its list: same texts and settings (print layout included), new ids, active, no starter key; returns its id. */
export function copyTemplate(
  db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date(), newId: () => string = randomUUID,
): number {
  const row = loadTemplate(db, facilityId, id, actor)
  const at = now.toISOString()
  return db.transaction((tx) => {
    const copy = tx.insert(formTemplates).values({
      facilityId, kind: row.kind, subject: row.subject, printLayout: row.printLayout, name: copyName(tx, facilityId, row.kind, row.name), selfAssessment: row.selfAssessment,
      categoryId: row.categoryId, content: JSON.stringify(freshIds(templateContent(row), newId)),
      createdAt: at, updatedAt: at, updatedBy: actorName(tx, actor),
    }).returning({ id: formTemplates.id }).get().id
    toEnd(tx, facilityId, copy)
    return copy
  })
}

/** The starter keys the facility has been given (form_starter_seeds). */
function seededKeys(db: Db, facilityId: number): Set<string> {
  return new Set(db.select({ key: formStarterSeeds.starterKey }).from(formStarterSeeds)
    .where(eq(formStarterSeeds.facilityId, facilityId)).all().map(row => row.key))
}

/**
 * Creates every starter template the facility has not been given yet (by key, see form_starter_seeds) and records it
 * as given, so a starter deleted or renamed later is not created again while a new starter still arrives. A template
 * already carrying the key is only recorded. With `only`, the other starters are recorded as given without being
 * created (a new facility: NEW_FACILITY_STARTER_KEYS). Call it inside the caller's transaction.
 */
export function seedStarterTemplates(
  db: Db, facilityId: number, now: Date = new Date(), newId: () => string = randomUUID, only?: readonly StarterKey[],
): void {
  // The example categories first (once), so the starters are filed into the one of their kind.
  seedFormCategories(db, facilityId, now)
  const seeded = seededKeys(db, facilityId)
  const present = new Set(db.select({ key: formTemplates.starterKey }).from(formTemplates)
    .where(eq(formTemplates.facilityId, facilityId)).all().map(row => row.key))
  const at = now.toISOString()
  for (const starter of STARTERS) {
    if (seeded.has(starter.key)) continue
    if (!present.has(starter.key) && (!only || only.includes(starter.key))) {
      // A template of the facility's own may already use the name; the starter then gets a free one.
      const taken = existingNames(db, facilityId, starter.kind)
        .some(row => row.name.toLocaleLowerCase('de') === starter.name.toLocaleLowerCase('de'))
      const categoryId = exampleCategoryOf(db, facilityId, starter.kind)
      const id = db.insert(formTemplates).values({
        categoryId,
        facilityId, kind: starter.kind, subject: starter.subject ?? null, printLayout: starter.printLayout ?? null, starterKey: starter.key, selfAssessment: starter.selfAssessment,
        name: taken ? copyName(db, facilityId, starter.kind, starter.name) : starter.name,
        content: JSON.stringify(checkContent(starterContent(starter, newId))), createdAt: at, updatedAt: at, updatedBy: '',
      }).returning({ id: formTemplates.id }).get().id
      toEnd(db, facilityId, id)
    }
    db.insert(formStarterSeeds).values({ facilityId, starterKey: starter.key, seededAt: at }).run()
  }
}

/** Startup step: seeds the missing starters of every facility that lacks one (e.g. a starter new in this version); returns how many facilities. */
export function seedPendingStarterTemplates(db: Db, now: Date = new Date()): number {
  const keys = STARTERS.map(starter => starter.key)
  const pending = db.select({ id: facilities.id }).from(facilities).all()
    .filter(facility => { const seeded = seededKeys(db, facility.id); return keys.some(key => !seeded.has(key)) })
  for (const facility of pending) db.transaction(tx => seedStarterTemplates(tx, facility.id, now))
  return pending.length
}
