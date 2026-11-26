<script setup lang="ts">
import { exampleKindOf } from '#shared/domain/formCategories'
import { FORM_KINDS, FORM_LIMITS, type FormKind, type FormSubject } from '#shared/domain/forms'
import { matchesSearch } from '#shared/domain/search'
import { TEMPLATE_VISIBILITIES, visibleTemplateLevels, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { CategoryNameDto, DocumentTargetOptionsDto, FormTemplateDto, PrintTemplateDto, TemplateCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import type { RowAction } from '~/utils/rowActions'
import { pickedFile, uploadSizeError } from '~/utils/uploads'
import {
  asksForCategories, emptyTargets, facilitiesLost, targetHints, targetsFormOf, targetsNeedChoice, targetsPayload, targetsProblem, type TargetsForm,
} from '~/utils/documentTargets'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { focusOrderArrow, orderArrowId } from '~/utils/orderArrows'
import { fillKinds } from '~/utils/pdfFill'
import {
  berlinDay, categoryOfNames, defaultGlobalVisibility, readTemplateTabMemory, templateFileUrl, templatePath, titleFromFileName,
  writeTemplateTabMemory,
} from '~/utils/printTemplates'
import { filedCategoryId, subcategoryChip, subcategoryItems, subcategoryNamesFor, topCategories, type ItemGroup } from '~/utils/subcategories'
import {
  chosenLibraryTab, filedVisibility, libraryGroups, librarySearch, libraryTabs, losersOf, movedEntries, type LibraryEntry,
} from '~/utils/templateEntries'

/**
 * „Dokumente“ → „Vorlagen“ (the tab key stays `templates`): the Bögen (form templates, filled in the app; whoever manages
 * them, formTemplates.manage) and the PDF templates (printed or filled as PDF; printTemplates.view, the tablet without
 * an unlock) side by side in the facility's categories – one sub-tab per category the viewer sees (the server filters
 * by „Wer sieht sie?“, which applies to both kinds), „Vom Träger“ for PDF templates for all facilities whose category
 * name the facility has no category of, and „Ohne Kategorie“ for Bögen filed in none. Each entry says its kind („Bogen –
 * im Programm ausfüllen“ / „PDF – ausdrucken oder ausfüllen“) and has the buttons of its kind, with the rights of its
 * kind: a Bogen „Bearbeiten“ (the editor, FormsTemplateEditor), „Leer drucken“, „Kopieren“, „Verschieben“, „Stilllegen“,
 * „Löschen“; a PDF „Öffnen“, „Ausfüllen“, „Zum Unterschreiben senden“, „Bearbeiten“, „Löschen“ (printTemplates.edit).
 * „Neue Vorlage“ first asks „Bogen“ or „PDF hochladen“ (only the kinds the viewer may add). One search over both kinds,
 * one order (▲/▼ after „Reihenfolge ändern“) over both kinds within each list (an entry one may not move keeps its
 * place). A category with subcategories shows a panel of small tabs below it („Alle“, „Allgemein“, the subcategories,
 * each with its count; „Alle“ lists the entries in sections). The device remembers the last sub-tab and small tab.
 * Stopped Bögen of a tab are listed below it, folded. On phones a row shows its first button and a „⋯“ menu.
 */
const { user } = useUserSession()
const { can } = useCan()
const onTabletRole = computed(() => user.value?.role === 'terminal')
const seesPdfs = computed(() => onTabletRole.value || can('printTemplates.view'))
const canEditPdfs = computed(() => can('printTemplates.edit'))
// „für alle Einrichtungen“ (printTemplates.global, the Träger's).
const canEditGlobal = computed(() => can('printTemplates.global'))
const managesForms = computed(() => !onTabletRole.value && can('formTemplates.manage'))
const canOrder = computed(() => canEditPdfs.value || managesForms.value)
// The shared categories: whoever maintains either kind (each request by the route of a right the editor holds).
const canManageCategories = canOrder
// The visibilities the editor may give a category (or a template for all facilities): those of the own role.
const categoryLevels = computed(() => (user.value ? visibleTemplateLevels(user.value.role) : []))
const { activeName } = useFacilities()
// „Ausfüllen“ of a PDF: for a child or a person of the team, where the viewer may add documents (the tablet only while
// unlocked by such a person). Unsaved input in the fill view asks before the page is left.
const { rights, onTablet } = useChildRights()
const fillTargets = computed(() => fillKinds({ onTablet: onTablet.value, tabletMayEdit: rights.value?.canEdit ?? false, can }))
const filling = ref<{ id: number; title: string } | undefined>(undefined)
const fillOpen = ref(false)
function startFill(template: PrintTemplateDto) {
  filling.value = { id: template.id, title: template.title }
  fillOpen.value = true
}
// „Zum Unterschreiben senden“ (signRequests.manage): the PDF to employees of the facility, to sign in the app.
const canSend = computed(() => can('signRequests.manage'))
const sending = ref<{ kind: 'template'; id: number; title: string; url: string } | null>(null)
const sendOpen = ref(false)
function startSend(template: PrintTemplateDto) {
  sending.value = { kind: 'template', id: template.id, title: template.title, url: templateFileUrl(template.id) }
  sendOpen.value = true
}
useUnsavedGuard()

// Each kind with its own right; the categories from the PDF side, else (Bögen without printTemplates.view) the Bögen's.
const pdfFetch = await useFetch<PrintTemplateDto[]>('/api/print-templates', { default: () => [], immediate: seesPdfs.value })
const formFetch = await useFetch<FormTemplateDto[]>('/api/form-templates', { default: () => [], immediate: managesForms.value })
const categoryFetch = await useFetch<TemplateCategoryDto[]>(seesPdfs.value ? '/api/template-categories' : '/api/form-template-categories', {
  default: () => [], immediate: seesPdfs.value || managesForms.value,
})
const error = computed(() => pdfFetch.error.value ?? formFetch.error.value ?? null)
const pdfs = computed(() => pdfFetch.data.value ?? [])
const forms = computed(() => formFetch.data.value ?? [])
const categories = computed(() => categoryFetch.data.value ?? [])
const tabs = computed(() => libraryTabs(categories.value, pdfs.value, forms.value))
const topItems = computed(() => topCategories(categories.value).map(category => ({ label: category.name, value: category.id })))
const refresh = () => Promise.all([
  seesPdfs.value ? pdfFetch.refresh() : null, managesForms.value ? formFetch.refresh() : null,
  seesPdfs.value || managesForms.value ? categoryFetch.refresh() : null,
])
// At the tablet: templates limited to groups follow the person who unlocked it.
useRefreshOnTabletUnlock(refresh)

// ---- sub-tabs ------------------------------------------------------------
const wantedTab = ref<string | null>(null)
const tab = computed(() => chosenLibraryTab(tabs.value, wantedTab.value))
const current = computed(() => tabs.value.find(entry => entry.key === tab.value) ?? null)
// ---- subcategories: the panel of small tabs and the sections --------------
const groups = computed(() => (current.value ? libraryGroups(current.value) : []))
const { chips, chip, selectChip, shown, sections, isOpen, setOpen, readMemory: readSubMemory } = useSubcategoryView(
  { chips: 'dienstplan.templatesSubTab', collapsed: 'dienstplan.templatesCollapsed' }, () => current.value?.key ?? null, groups,
)
const shownCount = computed(() => shown.value.reduce((sum, group) => sum + group.items.length, 0))
const groupName = (group: ItemGroup<TemplateCategoryDto, LibraryEntry>) => group.subcategory?.name ?? de.printTemplates.generalChip
/** The note when nothing shows: an empty subcategory, else an empty category. */
const emptyText = computed(() => (current.value?.subcategories.some(sub => subcategoryChip(sub.id) === chip.value)
  ? de.printTemplates.emptySubcategory
  : de.templateLibrary.emptyCategory))
// The device's memory is read after mounting on a full page load (so the server's page matches), at once otherwise.
function readMemory() {
  wantedTab.value = readTemplateTabMemory()
  readSubMemory()
}
if (import.meta.client && !useNuxtApp().isHydrating) readMemory()
else onMounted(readMemory)
function selectTab(key: string) {
  wantedTab.value = key
  writeTemplateTabMemory(key)
}
/** Arrow keys, Home and End move between the sub-tabs (and open the one reached), as in a tab list. */
function onTabKey(event: KeyboardEvent) {
  const keys = tabs.value.map(entry => entry.key)
  const index = keys.indexOf(tab.value ?? '')
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  selectTab(keys[next])
  nextTick(() => document.getElementById(`templates-tab-${keys[next]}`)?.focus())
}
const tabLabel = (entry: { kind: string; category: TemplateCategoryDto | null }) =>
  entry.category?.name ?? (entry.kind === 'provider' ? de.printTemplates.fromProvider : de.templateLibrary.noCategory)

// ---- search --------------------------------------------------------------
// Title (name), category and subcategory of both kinds in every category the viewer sees (umlaut spellings and case
// aside), stopped Bögen too. While a term is entered, the matches replace the sub-tabs, grouped by „Kategorie ›
// Unterkategorie“; clearing it returns to the sub-tab open before.
const search = ref('')
const searching = computed(() => search.value.trim() !== '')
const matches = (entry: LibraryEntry) => (entry.type === 'pdf'
  ? matchesSearch([entry.pdf.title, entry.pdf.category, entry.pdf.subcategory], search.value)
  : matchesSearch([entry.form.name, entry.form.category ?? ''], search.value))
const foundGroups = computed(() => (searching.value
  ? librarySearch(tabs.value, matches, { provider: de.printTemplates.fromProvider, none: de.templateLibrary.noCategory })
  : []))
const foundCount = computed(() => foundGroups.value.reduce((sum, group) => sum + group.entries.length, 0))
/** The hints for Leitung and Träger: „nur Kita A, Kita B“, „nur Bären, Füchse“, „keine Gruppe mehr gewählt“. */
const hintsOf = (template: PrintTemplateDto) => targetHints(template.targets, { only: de.documentTargets.only, noGroup: de.documentTargets.noGroup, noFacility: de.documentTargets.noFacility })

// ---- „Neue Vorlage“: Bogen or PDF ----------------------------------------
const choosing = ref(false)
function startNewTemplate() {
  if (managesForms.value && canEditPdfs.value) choosing.value = true
  else if (managesForms.value) startNewForm()
  else openNewPdf()
}
function chooseKind(kind: 'form' | 'pdf') {
  choosing.value = false
  if (kind === 'form') startNewForm()
  else openNewPdf()
}

// ---- PDF: upload and change ------------------------------------------------
const { busy, run } = useBusyAction(refresh)
const confirm = useConfirm()
const toast = useToast()

const open = ref(false)
const managing = ref(false)
/** null = a new upload, otherwise the template being changed. */
const editing = ref<PrintTemplateDto | null>(null)
const file = shallowRef<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
/** `subcategoryId` 0 = directly in the category („Allgemein“); `subcategoryName` '' = none (a template for all facilities). */
const form = reactive<{
  title: string; categoryId: number | undefined; subcategoryId: number; targets: TargetsForm; categoryName: string
  subcategoryName: string; visibility: TemplateVisibility
}>({ title: '', categoryId: undefined, subcategoryId: 0, targets: emptyTargets(), categoryName: '', subcategoryName: '', visibility: 'all' })
const subcategoryChoices = computed(() => subcategoryItems(categories.value, form.categoryId, de.printTemplates.noSubcategory))
// Another category: a subcategory of the one before no longer fits.
watch(() => form.categoryId, () => {
  if (!subcategoryChoices.value.some(item => item.value === form.subcategoryId)) form.subcategoryId = 0
})
/** The title the last chosen file suggested; a title typed by hand is not overwritten by the next file. */
let suggestedTitle = ''
/** For all or the chosen facilities (the Träger's): filed by category name (with the names the facilities use as suggestions). */
const forAll = computed(() => form.targets.scope !== 'facility')
// What „Gilt für“ offers (the Träger every facility with its groups, everyone else the own facility), loaded with the form.
// Saving waits for them (else a limit could not be shown and kept); a failed load offers to try again. „Gilt für“ is sent
// only when the editor changed it, otherwise the server keeps it as it is.
const targetOptions = ref<DocumentTargetOptionsDto | null>(null)
const targetsFailed = ref(false)
const targetsTouched = ref(false)
async function loadTargetOptions() {
  targetsFailed.value = false
  try {
    targetOptions.value = await $fetch<DocumentTargetOptionsDto>('/api/print-templates/targets')
  }
  catch {
    targetsFailed.value = true
  }
}
const visibilityItems = computed(() => TEMPLATE_VISIBILITIES.filter(level => categoryLevels.value.includes(level))
  .map(level => ({ label: de.printTemplates.categories.visibilities[level], value: level })))
// The category names the facilities use, loaded afresh each time the Träger files a template for all facilities (so a
// name typed for the last upload is offered too).
const categoryNames = ref<CategoryNameDto[]>([])
async function loadCategoryNames() {
  if (!canEditGlobal.value) return
  categoryNames.value = await $fetch<CategoryNameDto[]>('/api/template-categories/names').catch(() => categoryNames.value)
}
/** The subcategory names used under the typed category name, as suggestions. */
const subcategoryNames = computed(() => subcategoryNamesFor(categoryNames.value, form.categoryName))
watch(forAll, (value) => {
  if (value && open.value) loadCategoryNames()
})
// A new template for all facilities starts with the visibility that applies at the facility's category (and subcategory)
// of the typed (or chosen) names – the stricter of both –, so one meant for a restricted place is not shown to everyone
// where a facility lacks that category. Can be changed.
watch(() => [form.categoryName, form.subcategoryName] as const, ([name, subName]) => {
  if (editing.value !== null || !open.value) return
  const { category, subcategory } = categoryOfNames(categories.value, name, subName)
  if (category) form.visibility = defaultGlobalVisibility(category, categoryLevels.value, subcategory)
})

function resetFile() {
  file.value = null
  suggestedTitle = ''
  if (fileInput.value) fileInput.value.value = ''
}

/** The open sub-tab's category and small tab's subcategory (a subcategory's small tab), the likely place of a new entry. */
function placeOfTab(): { category: TemplateCategoryDto | null; subcategory: TemplateCategoryDto | null } {
  const category = current.value?.category ?? null
  const subcategory = current.value?.subcategories.find(sub => subcategoryChip(sub.id) === chip.value) ?? null
  return { category, subcategory }
}

function openNewPdf() {
  editing.value = null
  resetFile()
  // The open sub-tab's category (and small tab's subcategory) is the likely one; with a single category there is nothing
  // to choose.
  const tops = topCategories(categories.value)
  const { category, subcategory } = placeOfTab()
  const preset = category?.id ?? (tops.length === 1 ? tops[0]!.id : undefined)
  const presetName = category?.name ?? current.value?.entries.find(entry => entry.type === 'pdf')?.pdf?.category ?? ''
  // For all facilities: as restricted as the open sub-tab's category and small tab's subcategory, the stricter of both
  // (none for „Vom Träger“).
  const visibility = defaultGlobalVisibility(category, categoryLevels.value, subcategory)
  Object.assign(form, {
    title: '', categoryId: preset, subcategoryId: subcategory?.id ?? 0, targets: emptyTargets(), categoryName: presetName,
    subcategoryName: subcategory?.name ?? '', visibility,
  })
  targetsTouched.value = false
  open.value = true
  loadTargetOptions()
}

function openEditPdf(template: PrintTemplateDto) {
  editing.value = template
  resetFile()
  Object.assign(form, {
    title: template.title, categoryId: template.categoryId ?? undefined, subcategoryId: template.subcategoryId ?? 0,
    targets: targetsFormOf(template.targets), categoryName: template.globalCategoryName ?? template.category,
    subcategoryName: template.globalSubcategoryName ?? template.subcategory, visibility: template.visibility,
  })
  // Without a facility or a group left the section must be filled in: checked like a change.
  targetsTouched.value = targetsNeedChoice(template.targets)
  open.value = true
  loadTargetOptions()
  if (template.global) loadCategoryNames()
}

function onFile(event: Event) {
  file.value = pickedFile(event, toast)
  if (!file.value || editing.value !== null) return
  if (form.title.trim() === '' || form.title === suggestedTitle) form.title = titleFromFileName(file.value.name)
  suggestedTitle = form.title
}

/** Fails early instead of after a long upload; the server checks the size and the real file type again. */
function checkFile(chosen: File): boolean {
  if (chosen.size > MAX_DOCUMENT_BYTES) {
    toast.add({ title: uploadSizeError(chosen.size)!, color: 'error' })
    return false
  }
  return true
}

function fileBody(chosen: File): FormData {
  const body = new FormData()
  body.append('file', chosen)
  return body
}

/**
 * The category part of the form: a category or subcategory of the facility, or for all or the chosen facilities the
 * category name and the subcategory name ('' for none).
 */
function filing(): { categoryId: number } | { categoryName: string; subcategoryName: string } | null {
  if (forAll.value) {
    if (form.categoryName.trim() !== '') return { categoryName: form.categoryName, subcategoryName: form.subcategoryName }
    toast.add({ title: de.errors.template_category_name_required, color: 'error' })
    return null
  }
  const categoryId = filedCategoryId(form.categoryId, form.subcategoryId)
  if (categoryId !== undefined) return { categoryId }
  toast.add({ title: de.errors.template_category_invalid, color: 'error' })
  return null
}

/** The note at a category that not everyone sees. */
const badgeOf = (visibility: TemplateVisibility) => (visibility === 'all' ? '' : de.printTemplates.visibilityBadge[visibility])

/** „Gilt für“ as it will be sent, after checking what is missing; null (with a message) when something is. */
function checkedTargets() {
  const ownFacilityId = targetOptions.value?.facilityId ?? null
  const problem = targetsProblem(form.targets, targetOptions.value, ownFacilityId)
  if (problem) {
    toast.add({ title: problem.kind === 'facility' ? de.documentTargets.pickFacility : de.documentTargets.pickGroup(problem.facility), color: 'error' })
    return null
  }
  return targetsPayload(form.targets, targetOptions.value, ownFacilityId)
}

const adoptCategory = useCategoryAdopt('print-templates')
async function savePdf() {
  const chosen = file.value
  const fields = filing()
  if (!fields || !targetOptions.value) return
  // Only a changed „Gilt für“ is sent (checked first); untouched, the server keeps it.
  const targets = targetsTouched.value ? checkedTargets() : null
  if (targetsTouched.value && !targets) return
  if (editing.value === null) {
    if (!chosen) return void toast.add({ title: de.errors.file_required, color: 'error' })
    if (!checkFile(chosen)) return
    // For several or all facilities: create the category (› subcategory) where it is missing („Nein“: „Vom Träger“ there)?
    const createCategories = forAll.value ? await adoptCategory(form.targets, form.categoryName, form.subcategoryName) : undefined
    if (createCategories === null) return
    const body = fileBody(chosen)
    body.append('title', form.title)
    body.append('visibility', form.visibility)
    if (targets) {
      body.append('scope', targets.scope)
      body.append('facilityIds', JSON.stringify(targets.facilityIds))
      body.append('groupTargets', JSON.stringify(targets.groupTargets))
    }
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value))
    if (createCategories) body.append('createCategories', 'true')
    if (await run(() => $fetch<unknown>('/api/print-templates', { method: 'POST', body }), de.common.saved)) open.value = false
    return
  }
  const id = editing.value.id
  if (chosen && !checkFile(chosen)) return
  // Facilities that lose the template: ask first.
  const lost = targetsTouched.value ? facilitiesLost(editing.value.targets, form.targets, targetOptions.value, targetOptions.value.facilityId) : 0
  if (lost > 0 && !(await confirm(de.documentTargets.confirmLosing(lost, 'die Vorlage')))) return
  // A change asks only when „Gilt für“ or the names changed (a „Nein“ is not asked again on every save).
  const before = { categoryName: editing.value.globalCategoryName, subcategoryName: editing.value.globalSubcategoryName }
  const asks = forAll.value && asksForCategories(before, form, targetsTouched.value)
  const createCategories = asks ? await adoptCategory(form.targets, form.categoryName, form.subcategoryName) : undefined
  if (createCategories === null) return
  const saved = await run(async () => {
    await $fetch<unknown>(`/api/print-templates/${id}`, {
      method: 'PUT', body: { title: form.title, visibility: form.visibility, ...targets ?? {}, ...fields, ...(createCategories ? { createCategories: true } : {}) },
    })
    if (chosen) await $fetch<unknown>(`/api/print-templates/${id}/file`, { method: 'PUT', body: fileBody(chosen) })
  }, de.common.saved)
  if (saved) open.value = false
}

async function removePdf(template: PrintTemplateDto) {
  if (await confirm(de.printTemplates.confirmDelete(template.title))) {
    run(() => $fetch<unknown>(`/api/print-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}

// ---- Bögen: new, move, copy, stop, delete, the editor ------------------------
const t = de.forms
const c = de.forms.categories
/** The Bogen open in the editor (FormsTemplateEditor replaces the list meanwhile). */
const editingFormId = ref<number | null>(null)
const formDialogOpen = ref(false)
/** null = a new Bogen, else the one moved. */
const moving = ref<FormTemplateDto | null>(null)
const subjectItems = (['child', 'employee'] as const).map(value => ({ label: t.subjects[value], value }))
const kindItems = FORM_KINDS.map(value => ({ label: t.forKinds[value], value }))
/** A category's name with who sees it when not everyone does („Intern (nur Leitung und Träger)“). */
const labelWithVisibility = (category: TemplateCategoryDto) =>
  (category.visibility === 'all' ? category.name : `${category.name} (${de.printTemplates.visibilityBadge[category.visibility]})`)
const formCategoryItems = computed(() => [
  { label: c.categoryNone, value: 0 },
  ...topCategories(categories.value).map(category => ({ label: labelWithVisibility(category), value: category.id })),
])
/** `kind` undefined until picked: preset only in an example category (Unfälle → für Unfälle …), see exampleKindOf. */
const draft = reactive<{ name: string; kind: FormKind | undefined; selfAssessment: boolean; subject: FormSubject; categoryId: number; subcategoryId: number }>({
  name: '', kind: undefined, selfAssessment: false, subject: 'child', categoryId: 0, subcategoryId: 0,
})
const draftSubItems = computed(() => [
  { label: c.subNone, value: 0 },
  ...categories.value.filter(row => row.parentId !== null && row.parentId === draft.categoryId).map(row => ({ label: labelWithVisibility(row), value: row.id })),
])
watch(() => draft.categoryId, () => {
  if (!draftSubItems.value.some(item => item.value === draft.subcategoryId)) draft.subcategoryId = 0
})
function startNewForm() {
  moving.value = null
  const { category, subcategory } = placeOfTab()
  Object.assign(draft, {
    name: '', kind: exampleKindOf(category?.name) ?? undefined, selfAssessment: false, subject: 'child',
    categoryId: category?.id ?? 0, subcategoryId: subcategory?.id ?? 0,
  })
  formDialogOpen.value = true
}
function startMove(template: FormTemplateDto) {
  moving.value = template
  Object.assign(draft, { name: template.name, kind: template.kind, categoryId: template.categoryId ?? 0, subcategoryId: template.subcategoryId ?? 0 })
  formDialogOpen.value = true
}
const savingForm = ref(false)
async function saveFormDialog() {
  if (savingForm.value) return
  if (!moving.value && !draft.name.trim()) return void toast.add({ title: t.nameFirst, color: 'warning' })
  if (!moving.value && !draft.kind) return void toast.add({ title: t.kindFirst, color: 'warning' })
  const categoryId = filedCategoryId(draft.categoryId || undefined, draft.subcategoryId) ?? null
  // A category not everyone sees: name the Bogen and who no longer gets it offered, and ask first (the server asks too).
  const from = moving.value ? (moving.value.subcategoryId ?? moving.value.categoryId) : null
  const losers = losersOf(filedVisibility(categories.value, from), filedVisibility(categories.value, categoryId))
  const target = categories.value.find(row => row.id === categoryId)
  if (losers && target && !(await confirm(de.templateLibrary.confirmRestricted(moving.value?.name ?? draft.name.trim(), target.name, de.templateLibrary.losers[losers])))) return
  const confirmRestricted = losers ? true : undefined
  savingForm.value = true
  try {
    if (moving.value) {
      await $fetch<unknown>(`/api/form-templates/${moving.value.id}`, { method: 'PUT', body: { categoryId, confirmRestricted } })
      await refresh()
      toast.add({ title: t.moved, color: 'success' })
      formDialogOpen.value = false
    }
    else {
      const { id } = await $fetch<{ id: number }>('/api/form-templates', {
        method: 'POST',
        body: {
          kind: draft.kind, name: draft.name, selfAssessment: draft.kind === 'staff' && draft.selfAssessment,
          subject: draft.kind === 'accident' ? draft.subject : null, categoryId, confirmRestricted,
        },
      })
      await refresh()
      toast.add({ title: t.created, color: 'success' })
      formDialogOpen.value = false
      editingFormId.value = id
    }
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
  finally {
    savingForm.value = false
  }
}
const copyForm = (template: FormTemplateDto) =>
  run(() => $fetch<unknown>(`/api/form-templates/${template.id}/copy`, { method: 'POST' }), t.copied)
const setArchived = (template: FormTemplateDto, value: boolean) =>
  run(() => $fetch<unknown>(`/api/form-templates/${template.id}`, { method: 'PUT', body: { archived: value } }),
    value ? t.archivedDone : t.unarchivedDone)
async function removeForm(template: FormTemplateDto) {
  if (await confirm(t.deleteTemplateConfirm(template.name))) {
    await run(() => $fetch<unknown>(`/api/form-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
/** Back from the editor: the list as it is now (a rename shows). */
function closeFormEditor() {
  editingFormId.value = null
}

// ---- order (▲/▼, both kinds in one order) ----------------------------------
/** The ▲/▼ show only while „Reihenfolge ändern“ is on (as in the list of Mitarbeiter). */
const reordering = ref(false)
/** Whether the viewer may move the entry: a PDF with printTemplates.edit, an active Bogen with formTemplates.manage. */
const movable = (entry: LibraryEntry) => (entry.type === 'pdf' ? canEditPdfs.value : managesForms.value && !entry.form.archived)
/** The movable entries of a list, to tell where the arrows end. */
const movableOf = (group: ItemGroup<TemplateCategoryDto, LibraryEntry>) => group.items.filter(movable)
/**
 * One place up or down among the entries of the list one may move: the server takes their whole order (the others
 * keep their places), by the route of a right the viewer holds.
 */
async function move(group: ItemGroup<TemplateCategoryDto, LibraryEntry>, entry: LibraryEntry, direction: -1 | 1) {
  const entries = movedEntries(group.items, movable, entry.key, direction)
  if (!entries) return
  const url = canEditPdfs.value ? '/api/print-templates/order' : '/api/form-templates/order'
  if (await run(() => $fetch<unknown>(url, { method: 'POST', body: { categoryId: group.groupId, entries } }))) {
    focusOrderArrow(`template-${entry.key}`, direction)
  }
}

// ---- the buttons of a row ------------------------------------------------
/** A PDF's buttons: „Öffnen“ first (on phones the only button, the rest in „⋯“); in the search without „Löschen“. */
function pdfActions(template: PrintTemplateDto, withDelete = true): RowAction[] {
  const editable = canEditPdfs.value && template.canEdit
  return [
    { key: 'open', label: de.printTemplates.open, icon: 'i-lucide-printer', to: templateFileUrl(template.id), target: '_blank', external: true },
    { key: 'fill', label: de.pdfFill.fill, icon: 'i-lucide-pencil-line', onClick: () => startFill(template), show: fillTargets.value.length > 0 },
    { key: 'send', label: de.signRequests.send, icon: 'i-lucide-signature', onClick: () => startSend(template), show: canSend.value },
    { key: 'edit', label: de.common.edit, icon: 'i-lucide-pencil', variant: 'ghost', disabled: busy.value, onClick: () => openEditPdf(template), show: editable },
    {
      key: 'delete', label: de.common.delete, icon: 'i-lucide-trash-2', color: 'error', variant: 'ghost', disabled: busy.value,
      onClick: () => removePdf(template), show: editable && withDelete,
    },
  ]
}
const copyAction = (template: FormTemplateDto): RowAction =>
  ({ key: 'copy', label: t.copy, icon: 'i-lucide-copy', variant: 'ghost', iconOnly: true, onClick: () => copyForm(template) })
const moveToAction = (template: FormTemplateDto): RowAction =>
  ({ key: 'move', label: t.moveTo, icon: 'i-lucide-folder-input', variant: 'ghost', iconOnly: true, onClick: () => startMove(template) })
const deleteFormAction = (template: FormTemplateDto): RowAction => ({
  key: 'delete', label: de.common.delete, icon: 'i-lucide-trash-2', color: 'error', variant: 'ghost', iconOnly: true,
  disabled: template.inUse, title: template.inUse ? t.inUseHint : undefined, onClick: () => removeForm(template),
})
const editFormAction = (template: FormTemplateDto): RowAction =>
  ({ key: 'edit', label: t.edit, icon: 'i-lucide-pencil', onClick: () => { editingFormId.value = template.id } })
const unarchiveAction = (template: FormTemplateDto): RowAction =>
  ({ key: 'unarchive', label: t.unarchive, icon: 'i-lucide-archive-restore', onClick: () => setArchived(template, false) })
/** A Bogen's buttons, as on „Bögen“ before: „Bearbeiten“ first; stopped ones „Wieder aktivieren“; in the search fewer. */
function formActions(template: FormTemplateDto, place: 'list' | 'archived' | 'search' = 'list'): RowAction[] {
  if (place === 'search') return [template.archived ? unarchiveAction(template) : editFormAction(template), copyAction(template)]
  if (place === 'archived') return [unarchiveAction(template), copyAction(template), moveToAction(template), deleteFormAction(template)]
  return [
    editFormAction(template),
    {
      key: 'print', label: t.printBlank, icon: 'i-lucide-printer', variant: 'ghost', iconOnly: true,
      to: `/admin/print/form-templates/${template.id}`, target: '_blank',
    },
    copyAction(template), moveToAction(template),
    { key: 'archive', label: t.archive, icon: 'i-lucide-archive', variant: 'ghost', iconOnly: true, onClick: () => setArchived(template, true) },
    deleteFormAction(template),
  ]
}
const actionsOf = (entry: LibraryEntry, place: 'list' | 'search' = 'list') =>
  (entry.type === 'pdf' ? pdfActions(entry.pdf, place === 'list') : formActions(entry.form, place))
/** The badge of the kind: „Bogen – im Programm ausfüllen“ / „PDF – ausdrucken oder ausfüllen“. */
const typeBadgeClass = (entry: LibraryEntry) => (entry.type === 'form' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-sky-50 text-sky-800 ring-sky-200')
const entryIcon = (entry: LibraryEntry) => (entry.type === 'form' ? 'i-lucide-clipboard-list' : 'i-lucide-file-text')
</script>

<template>
  <div class="space-y-4">
    <!-- A Bogen open in the editor replaces the list (back with „Zurück zur Liste“). -->
    <FormsTemplateEditor v-if="editingFormId !== null && forms.some(entry => entry.id === editingFormId)" :templates="forms" :template-id="editingFormId" :refresh="refresh" @close="closeFormEditor" />

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <p class="min-w-60 flex-1 text-sm text-gray-600">
          {{ de.templateLibrary.intro }}
        </p>
        <div v-if="canEditPdfs || managesForms" class="flex flex-wrap gap-2">
          <UButton v-if="canManageCategories" color="neutral" variant="outline" icon="i-lucide-folder-cog" :label="de.printTemplates.manageCategories" @click="managing = true" />
          <UButton
            v-if="canOrder && tabs.some(entry => entry.entries.length)" color="neutral" :variant="reordering ? 'solid' : 'outline'"
            :icon="reordering ? 'i-lucide-check' : 'i-lucide-arrow-up-down'" :label="reordering ? de.common.reorderDone : de.common.reorder"
            :aria-pressed="reordering" @click="reordering = !reordering"
          />
          <UButton icon="i-lucide-plus" :label="de.templateLibrary.newTemplate" @click="startNewTemplate" />
        </div>
      </div>
      <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
      <p v-else-if="!tabs.length" class="text-sm text-gray-500">{{ de.templateLibrary.none }}</p>

      <template v-else>
        <UInput v-model="search" icon="i-lucide-search" :placeholder="de.templateLibrary.searchPlaceholder" :aria-label="de.templateLibrary.search" class="w-full max-w-md" maxlength="100" />
        <!-- Searching: the matches of every category (both kinds), grouped by „Kategorie › Unterkategorie“, instead of the sub-tabs. -->
        <section v-if="searching" class="space-y-4" :aria-label="de.templateLibrary.search">
          <p class="text-sm text-gray-600" role="status">{{ de.templateLibrary.searchResults(foundCount) }}</p>
          <p v-if="!foundCount" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ de.templateLibrary.noMatch }}</p>
          <SubcategorySection
            v-for="group in foundGroups" :key="group.key" :section-id="`templates-found-${group.key}`" :title="group.heading"
            :count="de.templateLibrary.entryCount(group.entries.length)"
          >
            <ul class="divide-y divide-gray-100">
              <li v-for="entry in group.entries" :key="entry.key" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <UIcon :name="entryIcon(entry)" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
                <div class="flex min-w-48 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="font-medium break-words" :class="entry.form?.archived ? 'text-gray-600' : ''">{{ entry.title }}</span>
                  <span class="whitespace-nowrap rounded px-1.5 py-0.5 text-xs ring-1" :class="typeBadgeClass(entry)">{{ de.templateLibrary.typeBadge[entry.type] }}</span>
                  <template v-if="entry.type === 'form'">
                    <UBadge color="neutral" variant="outline" size="sm" :label="t.forKinds[entry.form.kind]" />
                    <UBadge v-if="entry.form.archived" color="neutral" variant="soft" size="sm" :label="t.archivedBadge" />
                  </template>
                  <template v-else>
                    <span v-if="entry.pdf.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="de.printTemplates.globalHint">{{ entry.pdf.allFacilities ? de.printTemplates.global : de.printTemplates.ownerBadge }}</span>
                    <span v-for="hint in hintsOf(entry.pdf)" :key="hint" class="whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">{{ hint }}</span>
                  </template>
                </div>
                <RowActions :actions="actionsOf(entry, 'search')" :name="entry.title" />
              </li>
            </ul>
          </SubcategorySection>
        </section>
        <div v-if="!searching" role="tablist" :aria-label="de.templateLibrary.tabsLabel" class="flex flex-wrap gap-1.5">
          <button
            v-for="entry in tabs" :id="`templates-tab-${entry.key}`" :key="entry.key" type="button" role="tab"
            :aria-selected="tab === entry.key" :tabindex="tab === entry.key ? 0 : -1" aria-controls="templates-tab-panel"
            class="min-h-11 rounded-full px-4 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="tab === entry.key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
            @click="selectTab(entry.key)" @keydown="onTabKey"
          >
            {{ tabLabel(entry) }}
          </button>
        </div>

        <section
          v-if="current && !searching" id="templates-tab-panel" role="tabpanel" :aria-labelledby="`templates-tab-${current.key}`"
          class="space-y-3"
        >
          <!-- Subcategories: a panel below the category chips with „Alle“, „Allgemein“ and each subcategory, with counts. -->
          <SubcategoryPanel
            v-if="current.category && chips.length" :model-value="chip" :chips="chips" id-prefix="templates-chip" controls="templates-tab-panel"
            :label="de.printTemplates.subTabsLabel(current.category.name)" :all-label="de.printTemplates.allChip"
            :general-label="de.printTemplates.generalChip" @update:model-value="selectChip"
          />
          <p v-if="!current.category || current.category.visibility !== 'all'" class="flex flex-wrap items-center gap-2 text-sm">
            <span v-if="current.category" class="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              {{ badgeOf(current.category.visibility) }}
            </span>
            <span v-else class="text-gray-600">{{ current.kind === 'provider' ? de.printTemplates.fromProviderHint : de.templateLibrary.noCategoryHint }}</span>
          </p>
          <p v-if="!shownCount" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ emptyText }}</p>
          <!-- „Alle“: one section per list („Allgemein“ first), each folding up; otherwise the one list. -->
          <div v-else class="space-y-5">
            <SubcategorySection
              v-for="group in shown" :key="group.key" :section-id="`templates-section-${group.key}`" :title="sections ? groupName(group) : null"
              :count="de.templateLibrary.entryCount(group.items.length)" :badge="group.subcategory ? badgeOf(group.subcategory.visibility) : ''"
              :collapsible="sections" :open="isOpen(group.key)" @update:open="setOpen(group.key, $event)"
            >
              <ul class="divide-y divide-gray-100" :class="sections ? '' : 'rounded-lg bg-white ring-1 ring-gray-200'">
                <li v-for="entry in group.items" :key="entry.key" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <UIcon :name="entryIcon(entry)" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
                  <!-- At least 12rem for the text; on a narrow screen the buttons move to their own line instead. -->
                  <div class="min-w-48 flex-1 space-y-0.5">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span class="font-medium break-words">{{ entry.title }}</span>
                      <span class="whitespace-nowrap rounded px-1.5 py-0.5 text-xs ring-1" :class="typeBadgeClass(entry)">{{ de.templateLibrary.typeBadge[entry.type] }}</span>
                      <template v-if="entry.type === 'form'">
                        <!-- „Wofür“ (fixed after creation) and what else marks the Bogen. -->
                        <UBadge color="neutral" variant="outline" size="sm" :label="t.forKinds[entry.form.kind]" />
                        <UBadge v-if="entry.form.starterKey" color="neutral" variant="soft" size="sm" :label="t.starter" />
                        <UBadge v-if="entry.form.selfAssessment" color="info" variant="soft" size="sm" :label="t.selfAssessmentBadge" />
                        <UBadge v-if="entry.form.subject" color="neutral" variant="outline" size="sm" :label="t.subjectBadge(t.subjects[entry.form.subject])" />
                      </template>
                      <template v-else>
                        <span v-if="entry.pdf.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="de.printTemplates.globalHint">{{ entry.pdf.allFacilities ? de.printTemplates.global : de.printTemplates.ownerBadge }}</span>
                        <span v-if="!current.category" class="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{{ templatePath(entry.pdf) }}</span>
                        <!-- „Gilt für“, for Leitung and Träger: „nur Kita A“, „nur Bären, Füchse“. -->
                        <span v-for="hint in hintsOf(entry.pdf)" :key="hint" class="whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">{{ hint }}</span>
                      </template>
                    </div>
                    <p v-if="entry.type === 'pdf'" class="text-xs text-gray-500">
                      {{ de.printTemplates.uploadedAt(formatDate(berlinDay(entry.pdf.uploadedAt))) }}
                      <template v-if="berlinDay(entry.pdf.updatedAt) !== berlinDay(entry.pdf.uploadedAt)"> · {{ de.printTemplates.updatedAt(formatDate(berlinDay(entry.pdf.updatedAt))) }}</template>
                      · {{ formatSize(entry.pdf.size) }}
                    </p>
                  </div>
                  <div class="flex flex-wrap items-center gap-1">
                    <RowActions :actions="actionsOf(entry)" :name="entry.title" />
                    <!-- ▲/▼ last (only after „Reihenfolge ändern“, at the entries one may move), so they stay in the same place in every row; 40 px for a finger. -->
                    <span v-if="reordering && movable(entry)" role="group" :aria-label="`${de.templateLibrary.order}: ${entry.title}`" class="flex items-center gap-1">
                      <UButton
                        :id="orderArrowId(`template-${entry.key}`, -1)" color="neutral" variant="ghost" icon="i-lucide-arrow-up"
                        class="min-h-10 min-w-10 justify-center" :aria-label="`${de.templateLibrary.moveUp}: ${entry.title}`"
                        :title="de.templateLibrary.moveUp" :disabled="busy || movableOf(group)[0]?.key === entry.key" @click="move(group, entry, -1)"
                      />
                      <UButton
                        :id="orderArrowId(`template-${entry.key}`, 1)" color="neutral" variant="ghost" icon="i-lucide-arrow-down"
                        class="min-h-10 min-w-10 justify-center" :aria-label="`${de.templateLibrary.moveDown}: ${entry.title}`"
                        :title="de.templateLibrary.moveDown" :disabled="busy || movableOf(group).at(-1)?.key === entry.key" @click="move(group, entry, 1)"
                      />
                    </span>
                  </div>
                </li>
              </ul>
            </SubcategorySection>
          </div>

          <!-- The stopped Bögen of the tab, folded. -->
          <details v-if="current.archived.length" class="rounded-lg bg-white px-4 py-2 ring-1 ring-gray-200">
            <summary class="cursor-pointer text-sm font-medium text-gray-700">{{ t.archivedList(current.archived.length) }}</summary>
            <ul class="mt-1 divide-y divide-gray-100">
              <li v-for="entry in current.archived" :key="entry.key" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <div class="min-w-0 flex-1 basis-48 break-words text-gray-600">
                  {{ entry.title }} <span v-if="entry.subcategoryId && entry.form" class="text-xs">· {{ entry.form.category }}</span>
                  <UBadge v-if="entry.form" color="neutral" variant="outline" size="sm" class="ml-1" :label="t.forKinds[entry.form.kind]" />
                </div>
                <RowActions v-if="entry.form" :actions="formActions(entry.form, 'archived')" :name="entry.title" />
              </li>
            </ul>
          </details>
        </section>
      </template>
      <p v-if="forms.some(template => template.inUse)" class="text-xs text-gray-500">{{ t.inUseHint }}</p>
    </template>

    <!-- „Neue Vorlage“: Bogen or PDF (only when the viewer may add both). -->
    <UModal v-model:open="choosing" :title="de.templateLibrary.chooseTitle">
      <template #body>
        <div class="grid gap-3 sm:grid-cols-2">
          <button
            type="button" class="flex min-h-24 flex-col items-start gap-1 rounded-lg p-4 text-left ring-1 ring-gray-200 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary"
            @click="chooseKind('form')"
          >
            <span class="flex items-center gap-2 font-semibold"><UIcon name="i-lucide-clipboard-list" class="size-5" aria-hidden="true" />{{ de.templateLibrary.chooseForm }}</span>
            <span class="text-sm text-gray-600">{{ de.templateLibrary.chooseFormHint }}</span>
          </button>
          <button
            type="button" class="flex min-h-24 flex-col items-start gap-1 rounded-lg p-4 text-left ring-1 ring-gray-200 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary"
            @click="chooseKind('pdf')"
          >
            <span class="flex items-center gap-2 font-semibold"><UIcon name="i-lucide-upload" class="size-5" aria-hidden="true" />{{ de.templateLibrary.choosePdf }}</span>
            <span class="text-sm text-gray-600">{{ de.templateLibrary.choosePdfHint }}</span>
          </button>
        </div>
      </template>
    </UModal>

    <!-- A new Bogen (name, „Wofür“, category; the open tab's by default) or moving one into another (sub)category. -->
    <UModal v-if="managesForms" v-model:open="formDialogOpen" :title="moving ? t.moveTitle(moving.name) : t.newTemplate">
      <template #body>
        <form class="grid gap-3" @submit.prevent="saveFormDialog">
          <template v-if="!moving">
            <UFormField :label="t.name" required>
              <UInput v-model="draft.name" :maxlength="FORM_LIMITS.templateName" class="w-full" required autofocus />
            </UFormField>
            <UFormField :label="t.kindPick" :help="draft.kind ? `${t.kindHints[draft.kind]} ${t.kindPickHint}` : t.kindPickHint" required>
              <USelect v-model="draft.kind" :items="kindItems" :placeholder="t.kindPlaceholder" class="w-full" />
            </UFormField>
            <UCheckbox v-if="draft.kind === 'staff'" v-model="draft.selfAssessment" :label="t.selfAssessment" :description="t.selfAssessmentHint" />
            <UFormField v-if="draft.kind === 'accident'" :label="t.subjectPick">
              <USelect v-model="draft.subject" :items="subjectItems" class="w-full" />
            </UFormField>
          </template>
          <UFormField :label="c.category">
            <USelect v-model="draft.categoryId" :items="formCategoryItems" class="w-full" />
          </UFormField>
          <UFormField v-if="draft.categoryId && draftSubItems.length > 1" :label="c.subcategory">
            <USelect v-model="draft.subcategoryId" :items="draftSubItems" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="moving ? t.moveTo : t.createTemplate" :loading="savingForm" :disabled="savingForm" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="formDialogOpen = false" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-if="canEditPdfs" v-model:open="open" :title="editing === null ? de.printTemplates.upload : de.printTemplates.edit">
      <template #body>
        <UAlert v-if="!categories.length && !forAll && !canEditGlobal" color="warning" variant="soft" :title="de.printTemplates.noCategory" />
        <form v-else class="grid gap-3" @submit.prevent="savePdf">
          <UFormField :label="editing === null ? de.printTemplates.file : de.printTemplates.replaceFile" :required="editing === null">
            <input
              ref="fileInput" type="file" accept="application/pdf,.pdf" :required="editing === null"
              class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
              @change="onFile"
            >
          </UFormField>
          <UFormField :label="de.printTemplates.name" :required="editing !== null">
            <UInput v-model="form.title" maxlength="200" class="w-full" :required="editing !== null" />
          </UFormField>
          <!-- „Gilt für“: facilities (the Träger) and groups; afterwards too. -->
          <DocumentTargetsField
            v-model="form.targets" :options="targetOptions" :can-global="canEditGlobal" :facility-id="targetOptions?.facilityId ?? null"
            :facility-name="activeName ?? ''" id-prefix="template-targets" @update:model-value="targetsTouched = true"
          />
          <UAlert
            v-if="targetsFailed" color="warning" variant="soft" :title="de.documentTargets.loadFailed"
            :actions="[{ label: de.documentTargets.retry, color: 'neutral', variant: 'outline', onClick: loadTargetOptions }]"
          />
          <template v-if="forAll">
            <UFormField :label="de.printTemplates.categoryName" :description="de.printTemplates.categoryNameHint" required>
              <UInput v-model="form.categoryName" maxlength="60" class="w-full" list="template-category-names" required autocomplete="off" />
              <datalist id="template-category-names">
                <option v-for="entry in categoryNames" :key="entry.name" :value="entry.name" />
              </datalist>
            </UFormField>
            <UFormField :label="de.printTemplates.subcategoryName" :description="de.printTemplates.subcategoryNameHint">
              <UInput v-model="form.subcategoryName" maxlength="60" class="w-full" list="template-subcategory-names" autocomplete="off" />
              <datalist id="template-subcategory-names">
                <option v-for="name in subcategoryNames" :key="name" :value="name" />
              </datalist>
            </UFormField>
          </template>
          <template v-else>
            <UAlert v-if="!categories.length" color="warning" variant="soft" :title="de.printTemplates.noCategory" />
            <template v-else>
              <UFormField :label="de.printTemplates.category" required>
                <USelect v-model="form.categoryId" :items="topItems" :placeholder="de.printTemplates.categoryPlaceholder" class="w-full" />
              </UFormField>
              <!-- Only when the chosen category has subcategories. -->
              <UFormField v-if="subcategoryChoices.length > 1" :label="de.printTemplates.subcategory">
                <USelect v-model="form.subcategoryId" :items="subcategoryChoices" class="w-full" />
              </UFormField>
            </template>
          </template>
          <UFormField
            :label="de.printTemplates.visibility"
            :description="forAll ? de.printTemplates.globalVisibilityHint : de.printTemplates.visibilityHint"
          >
            <USelect v-model="form.visibility" :items="visibilityItems" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="editing === null ? de.printTemplates.upload : de.common.save" :loading="busy" :disabled="busy || !targetOptions" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>

    <TemplatesCategoryManager
      v-if="canManageCategories" v-model:open="managing" :categories="categories" :levels="categoryLevels" :refresh="refresh"
      :forms="forms" :rights="{ pdfs: canEditPdfs, forms: managesForms }"
    />
    <PdfFillStart v-if="filling" v-model:open="fillOpen" :template="filling" />
    <SignRequestsSendDialog v-if="sending" v-model:open="sendOpen" :source="sending" />
  </div>
</template>
