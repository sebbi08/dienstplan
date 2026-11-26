import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import {
  facilitiesLosing, groupsAllow, inFacilityScope, isOrphan, seesAllGroups, type Audience, type ItemTargets,
} from '../../shared/domain/documentTargets'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import {
  categoryPlacer, compareSpots, seesAll, seesCategoryNode, spotVisibilities, stricterVisibility, visibleTemplateLevels, type CategorySpot,
  type TemplateVisibility,
} from '../../shared/domain/templateCategories'
import { entryKey, mergeEntries, type PlacedEntry, type TemplateEntryType } from '../../shared/domain/templateEntries'
import type { PrintTemplateDto, PrintTemplateMeta, PrintTemplateScope, Role, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { formTemplates, printTemplateOrder, printTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile } from '../lib/fileSignature'
import { fillableFile } from '../lib/pdfForm'
import {
  checkedTargets, facilitiesInScope, loadTargets, targetNames, targetsDto, targetsInput, targetsOf, writeTargets,
} from './documentTargets'
import { assertMayCreateCategories, createMissingCategories } from './categoryAdopt'
import { checkedCategoryName, chosenCategory, facilityCategories } from './templateCategories'

/**
 * Who uploads and maintains templates, in the facility they work in. What they may change follows from their own
 * permissions (printTemplates.edit, printTemplates.global); which categories they see from the role.
 */
export type TemplateActor = Pick<SessionUser, 'id' | 'role' | 'permissions'> & { facilityId: number; homeGroupId?: number | null }

/**
 * Who looks at templates: the role decides which categories they see (shared/domain/templateCategories.ts), the home
 * group which templates limited to groups (shared/domain/documentTargets.ts; none given: none), the permissions whether
 * they may change a template.
 */
export type TemplateViewer = Pick<SessionUser, 'role' | 'permissions'> & { facilityId: number; homeGroupId?: number | null }

/**
 * Templates are blank forms, no child data: whoever may see them (printTemplates.view: Leitung, Träger and, read only,
 * Mitarbeiter accounts) and the facility's tablet (no unlock). The rule requirePermission applies on the print template
 * routes; which templates they see depends on the categories' visibility and „Gilt für“.
 */
export function templateReaderFacility(user: SessionUser): number {
  if (user.role !== 'terminal' && !can(user.permissions, 'printTemplates.view')) throw new ServiceError(403, 'forbidden')
  if (user.facilityId === null) throw new ServiceError(403, 'no_facility')
  return user.facilityId
}

/** Only PDF files, with the size limit of the child documents; returns the detected type. */
const checkedPdf = (data: Buffer) => checkedDocumentFile(data, ['application/pdf'], 'print_template_type_invalid')

/** The Träger's templates belong to the Träger (printTemplates.global); the Leitung may only change those of its facility. */
const mayEdit = (permissions: ReadonlySet<PermissionKey>, row: { facilityId: number | null }) =>
  can(permissions, 'printTemplates.global') || (can(permissions, 'printTemplates.edit') && row.facilityId !== null)

type TemplateRow = Pick<typeof printTemplates.$inferSelect,
  'id' | 'facilityId' | 'categoryId' | 'categoryName' | 'subcategoryName' | 'visibility' | 'allFacilities'>
type CategoryRow = ReturnType<typeof facilityCategories>[number]

/** The audience of a viewer: their role and home group. */
const audienceOf = (viewer: { role: Role; homeGroupId?: number | null }): Audience => ({ role: viewer.role, homeGroupId: viewer.homeGroupId ?? null })

/**
 * Where a template shows in the facility: its category there (null = „Vom Träger“) and subcategory (null = directly in
 * the category), the list it is ordered in (`groupId`: the subcategory, else the category, null for „Vom Träger“), and
 * whether the viewer sees it.
 */
interface Placement {
  categoryId: number | null
  category: string
  subcategoryId: number | null
  subcategory: string
  groupId: number | null
  spot: CategorySpot<CategoryRow>
  visible: boolean
}

/**
 * Places the templates in the facility's categories: a facility's own template in its category or subcategory; a
 * template of the Träger in the facility's category of the same name (regardless of case) – there in its subcategory of
 * the subcategory name, else directly in the category –, otherwise under „Vom Träger“ (after all categories). A template
 * not for this facility is nowhere (null). The viewer sees a template when they see its category, subcategory and its
 * own visibility (the strictest one wins) and its groups allow them („Gilt für“). A template of the Träger whose chosen
 * facilities are all gone (`orphans`, for those with printTemplates.global) shows under „Vom Träger“, to be given
 * facilities again or deleted.
 */
function placer(
  db: Db, facilityId: number, audience: Audience, targets: ReadonlyMap<number, ItemTargets>, orphans = false,
): (row: TemplateRow) => Placement | null {
  const place = categoryPlacer(facilityCategories(db, facilityId))
  return (row) => {
    const own = row.facilityId !== null
    if (own && row.facilityId !== facilityId) return null
    const itemTargets = targets.get(row.id)
    const orphan = !own && !!itemTargets && isOrphan(itemTargets)
    if (!own && (!itemTargets || (orphan ? !orphans : !inFacilityScope(itemTargets, facilityId)))) return null
    const spot = own ? place.byId(row.categoryId) : orphan ? { category: null, subcategory: null } : place.byName(row.categoryName, row.subcategoryName)
    if (!spot) return null
    const visible = seesAll(audience.role, [...spotVisibilities(spot), row.visibility])
      && (!itemTargets || groupsAllow(itemTargets, facilityId, audience))
    return {
      categoryId: spot.category?.id ?? null,
      category: spot.category?.name ?? row.categoryName ?? '',
      subcategoryId: spot.subcategory?.id ?? null,
      subcategory: spot.subcategory?.name ?? (spot.category ? '' : row.subcategoryName ?? ''),
      groupId: spot.subcategory?.id ?? spot.category?.id ?? null,
      spot,
      visible,
    }
  }
}

/** The facility's own templates and the Träger's (whose „Gilt für“ decides whether they show here). */
const ofFacility = (facilityId: number) => or(eq(printTemplates.facilityId, facilityId), isNull(printTemplates.facilityId))

/** What the list shows of a template (never the file). */
const LISTED = {
  id: printTemplates.id, facilityId: printTemplates.facilityId, title: printTemplates.title, categoryId: printTemplates.categoryId,
  categoryName: printTemplates.categoryName, subcategoryName: printTemplates.subcategoryName, visibility: printTemplates.visibility, size: printTemplates.size,
  uploadedAt: printTemplates.uploadedAt, updatedAt: printTemplates.updatedAt, fillable: printTemplates.fillable, allFacilities: printTemplates.allFacilities,
}
type ListedRow = { [K in keyof typeof LISTED]: (typeof printTemplates.$inferSelect)[K] }

/** A template placed in one of the facility's sub-tabs, with its place there (print_template_order; none = not ordered yet). */
interface Placed { row: ListedRow; placement: Placement; order: number | undefined; targets: ItemTargets | undefined }

/**
 * The order within a list (a subcategory, the templates directly in a category, or „Vom Träger“): the templates ordered
 * with ▲/▼ (or uploaded since) by their place, then those of before without a place, alphabetical („Vom Träger“ by the
 * category name the Träger chose first), as they were listed before.
 */
const bySubTabOrder = (a: Placed, b: Placed) =>
  Number(a.order === undefined) - Number(b.order === undefined) || (a.order ?? 0) - (b.order ?? 0)
  || (a.placement.categoryId === null
    ? a.placement.category.localeCompare(b.placement.category, 'de') || a.placement.subcategory.localeCompare(b.placement.subcategory, 'de')
    : 0)
  || a.row.title.localeCompare(b.row.title, 'de') || a.row.id - b.row.id

/**
 * Every template for the facility in its list (`placement.groupId`: a subcategory, a category's own list, null = „Vom
 * Träger“) and order – by category, within it the templates directly in it first, then by subcategory –, also those the
 * viewer does not see (`placement.visible`). A facility template without a category of the facility shows nowhere.
 */
function placedTemplates(db: Db, facilityId: number, audience: Audience, orphans = false): Placed[] {
  const orders = new Map(db.select({ templateId: printTemplateOrder.templateId, sortOrder: printTemplateOrder.sortOrder })
    .from(printTemplateOrder).where(eq(printTemplateOrder.facilityId, facilityId)).all()
    .map(row => [row.templateId, row.sortOrder]))
  const rows = db.select(LISTED).from(printTemplates).where(ofFacility(facilityId)).all()
  const targets = loadTargets(db, 'template', rows)
  const place = placer(db, facilityId, audience, targets, orphans)
  return rows
    .map(row => ({ row, placement: place(row), order: orders.get(row.id), targets: targets.get(row.id) }))
    .filter((entry): entry is Placed => entry.placement !== null)
    .sort((a, b) => compareSpots(a.placement.spot, b.placement.spot) || bySubTabOrder(a, b))
}

/** Everyone, for the order: every template for the facility counts, visible or not. */
const EVERYONE: Audience = { role: 'provider', homeGroupId: null }

/** An entry of one of the facility's lists (shared/domain/templateEntries.ts): a PDF template with its placing, or a Bogen. */
type ListEntry = PlacedEntry & ({ type: 'pdf'; placed: Placed } | { type: 'form'; archived: boolean })

/**
 * Every entry of one list of the facility in its order – both kinds, also those the viewer does not see (`placed.visible`)
 * and stopped Bögen –: a subcategory, the entries directly in a category (by the category's id), or for null either „Vom
 * Träger“ (`nullList` 'pdf': the Träger's templates without a category of their name here) or the Bögen without a
 * category ('form'), the two lists that hold one kind only.
 */
export function listEntries(
  db: Db, facilityId: number, groupId: number | null, nullList: TemplateEntryType = 'pdf', audience: Audience = EVERYONE, orphans = false,
): ListEntry[] {
  const pdfs: ListEntry[] = groupId === null && nullList === 'form'
    ? []
    : placedTemplates(db, facilityId, audience, orphans).filter(entry => entry.placement.groupId === groupId)
        .map(entry => ({ type: 'pdf', id: entry.row.id, place: entry.order ?? null, placed: entry }))
  const forms: ListEntry[] = groupId === null && nullList === 'pdf'
    ? []
    : db.select({ id: formTemplates.id, archived: formTemplates.archived, sortOrder: formTemplates.sortOrder }).from(formTemplates)
        .where(and(eq(formTemplates.facilityId, facilityId), groupId === null ? isNull(formTemplates.categoryId) : eq(formTemplates.categoryId, groupId)))
        .all().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        .map(row => ({ type: 'form', id: row.id, place: row.sortOrder, archived: row.archived }))
  return mergeEntries(pdfs, forms)
}

/** Numbers one list of the facility afresh in the given order (0, 1, …): a PDF's place here, a Bogen's sort order. */
function writeEntries(db: Db, facilityId: number, entries: readonly Pick<PlacedEntry, 'type' | 'id'>[]): void {
  entries.forEach((entry, sortOrder) => {
    if (entry.type === 'form') {
      db.update(formTemplates).set({ sortOrder }).where(and(eq(formTemplates.id, entry.id), eq(formTemplates.facilityId, facilityId))).run()
      return
    }
    db.insert(printTemplateOrder).values({ facilityId, templateId: entry.id, sortOrder })
      .onConflictDoUpdate({ target: [printTemplateOrder.facilityId, printTemplateOrder.templateId], set: { sortOrder } }).run()
  })
}

/**
 * Puts the entry at the end of its list in the facility (a new upload or Bogen, a copy, filed elsewhere, or newly for
 * this facility). The others keep the order they show in, so those of before without a place (or with one from 0133)
 * get one (else they would sort after the new one). A Bogen's list is the category row it is filed in (null: the Bögen
 * without a category); a PDF template's where it shows in the facility (nowhere: nothing happens).
 */
export function appendEntry(db: Db, facilityId: number, entry: Pick<PlacedEntry, 'type' | 'id'>): void {
  let groupId: number | null
  if (entry.type === 'form') {
    const row = db.select({ categoryId: formTemplates.categoryId }).from(formTemplates)
      .where(and(eq(formTemplates.id, entry.id), eq(formTemplates.facilityId, facilityId))).get()
    if (!row) return
    groupId = row.categoryId
  }
  else {
    const self = placedTemplates(db, facilityId, EVERYONE).find(placed => placed.row.id === entry.id)
    if (!self) return
    groupId = self.placement.groupId
  }
  const others = listEntries(db, facilityId, groupId, entry.type).filter(other => other.type !== entry.type || other.id !== entry.id)
  writeEntries(db, facilityId, [...others, entry])
}

/** Where the template shows in each facility it is for: facility → its list there (undefined = nowhere). */
function subTabsOf(db: Db, row: TemplateRow): Map<number, number | null | undefined> {
  const targets = targetsOf(db, 'template', row)
  const all = new Map([[row.id, targets]])
  return new Map(facilitiesInScope(db, row, targets).map(facilityId => [facilityId, placer(db, facilityId, EVERYONE, all)(row)?.groupId]))
}

/**
 * The category name, subcategory name (none: directly in the category) of a template of the Träger, as the Träger
 * chose them.
 */
function globalFiling(input: PrintTemplateMeta): { categoryId: null; categoryName: string; subcategoryName: string | null } {
  const categoryName = checkedCategoryName(input.categoryName ?? '')
  const subcategoryName = (input.subcategoryName ?? '').trim() === '' ? null : checkedCategoryName(input.subcategoryName!)
  return { categoryId: null, categoryName, subcategoryName }
}

/** A visibility the actor sees (403 otherwise: a Leitung cannot make a template the Träger's alone). */
function checkedVisibility(role: Role, visibility: TemplateVisibility): TemplateVisibility {
  if (!visibleTemplateLevels(role).includes(visibility)) throw new ServiceError(403, 'forbidden')
  return visibility
}

/** A scope beyond the own facility is the Träger's (printTemplates.global, else 403). */
function assertScopeAllowed(permissions: ReadonlySet<PermissionKey>, scope: PrintTemplateScope): void {
  if (scope !== 'facility' && !can(permissions, 'printTemplates.global')) throw new ServiceError(403, 'forbidden')
}

/**
 * A new template: of the uploader's facility in one of the facility's categories they see, or of the Träger for all or
 * the chosen facilities under a category name; with „Gilt für“ (groups; for the Träger also facilities) and who sees
 * it. Returns its id.
 */
export function uploadTemplate(
  db: Db, actor: TemplateActor, input: PrintTemplateMeta & { scope: PrintTemplateScope },
  file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  const permissions = actor.permissions
  if (!can(permissions, 'printTemplates.edit')) throw new ServiceError(403, 'forbidden')
  assertScopeAllowed(permissions, input.scope)
  if (input.createCategories) assertMayCreateCategories('template', actor)
  const own = input.scope === 'facility'
  const filing = own
    ? { categoryId: chosenCategory(db, actor.role, actor.facilityId, input.categoryId).id, categoryName: null, subcategoryName: null }
    : globalFiling(input)
  const visibility = checkedVisibility(actor.role, input.visibility ?? 'all')
  const targets = checkedTargets(db, input.scope, own ? actor.facilityId : null, input)
  const mimeType = checkedPdf(file.data)
  // Prefilled from the file name in the form; an empty title falls back to it here as well.
  const title = input.title.trim() || file.filename.replace(/\.[^.]*$/, '').trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const at = now.toISOString()
  const facilityId = own ? actor.facilityId : null
  return db.transaction((tx) => {
    const id = tx.insert(printTemplates).values({
      facilityId,
      title: title.slice(0, 200),
      ...filing,
      visibility,
      allFacilities: targets.allFacilities,
      mimeType,
      fillable: fillableFile(file.data, mimeType),
      size: file.data.length,
      data: file.data,
      uploadedBy: actor.id,
      uploadedAt: at,
      updatedAt: at,
    }).returning({ id: printTemplates.id }).get().id
    writeTargets(tx, 'template', id, targets)
    const row = { id, facilityId, allFacilities: targets.allFacilities }
    const shownIn = facilitiesInScope(tx, row, targetsOf(tx, 'template', row))
    // Asked for: its category (and subcategory) where it is missing, so it shows there.
    if (input.createCategories && !own) createMissingCategories(tx, 'template', actor.facilityId, shownIn, filing.categoryName ?? '', filing.subcategoryName)
    // At the end of its category, in every facility it shows in.
    for (const facility of shownIn) appendEntry(tx, facility, { type: 'pdf', id })
    return id
  })
}

/**
 * The templates the viewer sees in the facility, in the order of the facility's categories („Vom Träger“ last) and
 * within each in the facility's order (▲/▼; those of before without a place after them, by title); `canEdit` by the
 * viewer's permissions; „Gilt für“ for Leitung, Träger and whoever may change the template.
 */
export function listTemplates(db: Db, viewer: TemplateViewer): PrintTemplateDto[] {
  const permissions = viewer.permissions
  const placed = placedTemplates(db, viewer.facilityId, audienceOf(viewer), can(permissions, 'printTemplates.global'))
    .filter(({ placement }) => placement.visible)
  const names = placed.length > 0 ? targetNames(db) : null
  return placed.map(({ row, placement, targets, order }) => {
    const canEdit = mayEdit(permissions, row)
    return {
      id: row.id,
      title: row.title,
      categoryId: placement.categoryId,
      category: placement.category,
      subcategoryId: placement.subcategoryId,
      subcategory: placement.subcategory,
      global: row.facilityId === null,
      globalCategoryName: row.facilityId === null ? row.categoryName ?? '' : null,
      globalSubcategoryName: row.facilityId === null ? row.subcategoryName ?? '' : null,
      globalVisibility: row.facilityId === null ? row.visibility : null,
      allFacilities: row.allFacilities,
      visibility: row.visibility,
      size: row.size,
      uploadedAt: row.uploadedAt,
      updatedAt: row.updatedAt,
      canEdit,
      // Judged when the file was stored; a template of before not judged yet (null) offers no „Ausfüllen“ yet.
      fillable: row.fillable === true,
      place: order ?? null,
      targets: (canEdit || seesAllGroups(viewer.role)) && targets && names ? targetsDto(row, targets, viewer.facilityId, names, canEdit) : null,
    }
  })
}

/**
 * A template for the viewer's facility that the viewer sees (for the Träger also one without facilities), else 404
 * print_template_not_found.
 */
function loadVisible(db: Db, viewer: TemplateViewer, id: number) {
  const row = db.select().from(printTemplates).where(and(eq(printTemplates.id, id), ofFacility(viewer.facilityId))).get()
  const targets = row ? loadTargets(db, 'template', [row]) : new Map<number, ItemTargets>()
  const orphans = can(viewer.permissions, 'printTemplates.global')
  if (!row || !placer(db, viewer.facilityId, audienceOf(viewer), targets, orphans)(row)?.visible) throw new ServiceError(404, 'print_template_not_found')
  return row
}

/**
 * The PDF, named after its title; a template not for the viewer's facility, in a category the viewer does not see, or
 * not for their group is 404 print_template_not_found.
 */
export function readTemplateFile(db: Db, viewer: TemplateViewer, id: number): { data: Buffer; mimeType: string; fileName: string } {
  const row = loadVisible(db, viewer, id)
  return { data: row.data, mimeType: row.mimeType, fileName: `${safeFileNamePart(row.title) || 'Vorlage'}.pdf` }
}

/**
 * Who sees the template where it shows for the viewer (404 print_template_not_found if they do not): the strictest of its
 * category's, its subcategory's and its own visibility. Kept with a request to sign (Zum Unterschreiben senden).
 */
export function templateVisibility(db: Db, viewer: TemplateViewer, id: number): TemplateVisibility {
  const row = loadVisible(db, viewer, id)
  const placement = placer(db, viewer.facilityId, audienceOf(viewer), loadTargets(db, 'template', [row]), can(viewer.permissions, 'printTemplates.global'))(row)!
  return stricterVisibility(...spotVisibilities(placement.spot), row.visibility)
}

/**
 * A template the actor sees (else 404 print_template_not_found: another facility's, or in a category they do not see)
 * and may change (else 403 forbidden).
 */
function loadEditable(db: Db, actor: TemplateActor, id: number) {
  const row = loadVisible(db, actor, id)
  if (!mayEdit(actor.permissions, row)) throw new ServiceError(403, 'forbidden')
  return row
}

/**
 * Renames the template, files it elsewhere and changes who sees it and „Gilt für“; the file stays.
 * - A facility's template goes in another of the facility's categories or subcategories the actor sees; its groups and
 *   its visibility may change (Leitung too).
 * - A template of the Träger goes under another category name, subcategory name, visibility and „Gilt für“.
 * - The Träger may also turn one into the other: the active facility's own template (a category of it), or a template
 *   for all or the chosen facilities (by name). Without `scope` the „Gilt für“ stays as it is.
 * Where it lands in another list (another subcategory or category), or newly shows in a facility, it goes to the end
 * there; a facility it no longer shows in forgets its place.
 */
export function updateTemplate(db: Db, actor: TemplateActor, id: number, meta: PrintTemplateMeta, now: Date = new Date()): void {
  const row = loadEditable(db, actor, id)
  const title = meta.title.trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const current = targetsInput(row, targetsOf(db, 'template', row))
  const scope = meta.scope ?? current.scope
  assertScopeAllowed(actor.permissions, scope)
  if (meta.createCategories) assertMayCreateCategories('template', actor)
  const own = scope === 'facility'
  // An own template stays with its facility; the Träger's becomes the active facility's.
  const facilityId = own ? row.facilityId ?? actor.facilityId : null
  if (own && facilityId !== actor.facilityId) throw new ServiceError(403, 'forbidden')
  const filing = own
    ? { categoryId: chosenCategory(db, actor.role, facilityId!, meta.categoryId).id, categoryName: null, subcategoryName: null }
    : globalFiling(meta)
  const visibility = checkedVisibility(actor.role, meta.visibility ?? row.visibility)
  const targets = checkedTargets(db, scope, facilityId, meta.scope === undefined ? { ...current, scope } : meta)
  const before = subTabsOf(db, row)
  db.transaction((tx) => {
    tx.update(printTemplates).set({ title, facilityId, ...filing, visibility, allFacilities: targets.allFacilities, updatedAt: now.toISOString() })
      .where(eq(printTemplates.id, id)).run()
    writeTargets(tx, 'template', id, targets)
    if (meta.createCategories && !own) {
      const saved = { id, facilityId, allFacilities: targets.allFacilities }
      createMissingCategories(tx, 'template', actor.facilityId, facilitiesInScope(tx, saved, targetsOf(tx, 'template', saved)), filing.categoryName ?? '', filing.subcategoryName)
    }
    const after = subTabsOf(tx, { ...row, facilityId, ...filing, allFacilities: targets.allFacilities })
    for (const [shownIn, subTab] of after) {
      if (!before.has(shownIn) || before.get(shownIn) !== subTab) appendEntry(tx, shownIn, { type: 'pdf', id })
    }
    const losing = facilitiesLosing([...before.keys()], [...after.keys()], [])
    if (losing.length > 0) {
      tx.delete(printTemplateOrder).where(and(eq(printTemplateOrder.templateId, id), inArray(printTemplateOrder.facilityId, losing))).run()
    }
  })
}

/**
 * The new order of a list of the actor's facility on „Vorlagen“ (▲/▼) – a subcategory, the entries directly in a category
 * („Allgemein“, by the category's id; a category without subcategories has only this list) of a category they see, or
 * null for „Vom Träger“ (PDF templates) or the Bögen without a category (as the entries say) –, as the editor sees it:
 * exactly the entries of the list the actor may move, each once (else 400 invalid_order). The actor moves the PDF
 * templates they see with printTemplates.edit (for a template of the Träger the order of this facility alone; the
 * Leitung may order them too) and the active Bögen with formTemplates.manage; without either right 403. Every other
 * entry – hidden, stopped, or of the other kind – keeps its place in between. The whole list is numbered afresh.
 */
export function orderEntries(
  db: Db, actor: TemplateActor, categoryId: number | null, entries: readonly Pick<PlacedEntry, 'type' | 'id'>[],
): void {
  const movesPdf = can(actor.permissions, 'printTemplates.edit')
  const movesForms = can(actor.permissions, 'formTemplates.manage')
  if (!movesPdf && !movesForms) throw new ServiceError(403, 'forbidden')
  if (categoryId !== null) {
    const all = facilityCategories(db, actor.facilityId)
    const category = all.find(row => row.id === categoryId)
    if (!category || !seesCategoryNode(actor.role, category, all)) throw new ServiceError(404, 'template_category_not_found')
  }
  const types = new Set(entries.map(entry => entry.type))
  if (categoryId === null && types.size > 1) throw new ServiceError(400, 'invalid_order')
  const nullList: TemplateEntryType = types.has('form') ? 'form' : 'pdf'
  const list = listEntries(db, actor.facilityId, categoryId, nullList, audienceOf(actor), can(actor.permissions, 'printTemplates.global'))
  const movable = (entry: ListEntry) => (entry.type === 'pdf' ? movesPdf && entry.placed.placement.visible : movesForms && !entry.archived)
  const keys = new Set(list.filter(movable).map(entryKey))
  const sent = entries.map(entryKey)
  if (sent.length !== keys.size || new Set(sent).size !== sent.length || !sent.every(key => keys.has(key))) {
    throw new ServiceError(400, 'invalid_order')
  }
  // The movable ones take the movable places in the new order, the others stay put.
  let next = 0
  const order = list.map(entry => (movable(entry) ? entries[next++]! : entry))
  db.transaction(tx => writeEntries(tx, actor.facilityId, order))
}

/** A new file for the template (same id, title and category). */
export function replaceTemplateFile(
  db: Db, actor: TemplateActor, id: number, file: { data: Buffer; filename: string }, now: Date = new Date(),
): void {
  loadEditable(db, actor, id)
  const mimeType = checkedPdf(file.data)
  db.update(printTemplates).set({
    mimeType, fillable: fillableFile(file.data, mimeType), size: file.data.length, data: file.data, updatedAt: now.toISOString(),
  }).where(eq(printTemplates.id, id)).run()
}

export function deleteTemplate(db: Db, actor: TemplateActor, id: number): void {
  loadEditable(db, actor, id)
  db.delete(printTemplates).where(eq(printTemplates.id, id)).run()
}
