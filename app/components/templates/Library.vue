<script setup lang="ts">
import { TEMPLATE_VISIBILITIES, visibleTemplateLevels, type TemplateVisibility } from '#shared/domain/templateCategories'
import { matchesSearch } from '#shared/domain/search'
import type { CategoryNameDto, DocumentTargetOptionsDto, PrintTemplateDto, TemplateCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { pickedFile, uploadSizeError } from '~/utils/uploads'
import {
  asksForCategories, emptyTargets, facilitiesLost, targetHints, targetsFormOf, targetsNeedChoice, targetsPayload, targetsProblem, type TargetsForm,
} from '~/utils/documentTargets'
import { errorMessage } from '~/utils/errors'
import { moveInList } from '~/utils/consentSettings'
import { formatDate } from '~/utils/format'
import { focusOrderArrow, orderArrowId } from '~/utils/orderArrows'
import { fillKinds } from '~/utils/pdfFill'
import {
  berlinDay, categoryOfNames, chosenTemplateTab, defaultGlobalVisibility, readTemplateTabMemory, templateFileUrl, templatePath, templateTabs,
  titleFromFileName, writeTemplateTabMemory,
} from '~/utils/printTemplates'
import {
  filedCategoryId, itemGroups, searchGroups, subcategoryChip, subcategoryItems, subcategoryNamesFor, topCategories, type ItemGroup,
} from '~/utils/subcategories'

/**
 * „Dokumente“ → „Vorlagen“: blank PDF forms to open and print, one sub-tab per category of the facility (in its order,
 * only those the viewer sees; the server filters) and „Vom Träger“ for templates for all facilities whose category name
 * the facility has no category of. Whoever may edit templates (printTemplates.edit: Träger and Leitung by default, a
 * Mitarbeiter with „Vorlagen bearbeiten“) uploads and maintains them and the facility's categories, everyone else and
 * the tablet (no unlock, they are no child data) only open them. The device remembers the last sub-tab. Editors order
 * the templates of a sub-tab with ▲/▼ (this facility's order, also for the Träger's templates); everyone sees that order.
 * A category with subcategories shows a panel of small tabs below it („Alle“, „Allgemein“, the subcategories, each with
 * its count; the device remembers the last one per category): „Alle“ lists the templates in sections, „Allgemein“ first,
 * then one per subcategory (empty ones left out), each folding up (remembered per category on the device), and ▲/▼ order
 * within each section – the same list as the subcategory's own small tab.
 */
const { user } = useUserSession()
const { can } = useCan()
const canEdit = computed(() => can('printTemplates.edit'))
// „für alle Einrichtungen“ (printTemplates.global, the Träger's).
const canEditGlobal = computed(() => can('printTemplates.global'))
// The visibilities the editor may give a category (or a template for all facilities): those of the own role.
const categoryLevels = computed(() => (user.value ? visibleTemplateLevels(user.value.role) : []))
const { activeName } = useFacilities()
// „Ausfüllen“: any template (all are PDFs: fields, text, tick, cross, signature) for a child or a person of the team,
// where the viewer may add documents (the tablet only while unlocked by such a person). Unsaved input in the fill view
// asks before the page is left.
const { rights, onTablet } = useChildRights()
const fillTargets = computed(() => fillKinds({ onTablet: onTablet.value, tabletMayEdit: rights.value?.canEdit ?? false, can }))
const filling = ref<{ id: number; title: string } | undefined>(undefined)
const fillOpen = ref(false)
function startFill(template: PrintTemplateDto) {
  filling.value = { id: template.id, title: template.title }
  fillOpen.value = true
}
useUnsavedGuard()

const { data, refresh: refreshTemplates, error } = await useFetch<PrintTemplateDto[]>('/api/print-templates', { default: () => [] })
const { data: categoryData, refresh: refreshCategories } = await useFetch<TemplateCategoryDto[]>('/api/template-categories', { default: () => [] })
const templates = computed(() => data.value ?? [])
const categories = computed(() => categoryData.value ?? [])
const tabs = computed(() => templateTabs(categories.value, templates.value))
const categoryItems = computed(() => topCategories(categories.value).map(category => ({ label: category.name, value: category.id })))
const refresh = () => Promise.all([refreshTemplates(), refreshCategories()])
// At the tablet: templates limited to groups follow the person who unlocked it.
useRefreshOnTabletUnlock(refresh)

// ---- sub-tabs ------------------------------------------------------------
const wantedTab = ref<string | null>(null)
const tab = computed(() => chosenTemplateTab(tabs.value, wantedTab.value))
const current = computed(() => tabs.value.find(entry => entry.key === tab.value) ?? null)
// ---- subcategories: the panel of small tabs and the sections --------------
/** The lists of the open sub-tab: the templates directly in the category, then one per subcategory. */
const groups = computed(() => (current.value ? itemGroups(current.value.category, current.value.subcategories, current.value.templates) : []))
const { chips, chip, selectChip, shown, sections, isOpen, setOpen, readMemory: readSubMemory } = useSubcategoryView(
  { chips: 'dienstplan.templatesSubTab', collapsed: 'dienstplan.templatesCollapsed' }, () => current.value?.key ?? null, groups,
)
const shownCount = computed(() => shown.value.reduce((sum, group) => sum + group.items.length, 0))
const groupName = (group: ItemGroup<TemplateCategoryDto, PrintTemplateDto>) => group.subcategory?.name ?? de.printTemplates.generalChip
/** The note when nothing shows: an empty subcategory, else an empty category. */
const emptyText = computed(() => (current.value?.subcategories.some(sub => subcategoryChip(sub.id) === chip.value)
  ? de.printTemplates.emptySubcategory
  : de.printTemplates.emptyCategory))
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
const tabKeys = computed(() => tabs.value.map(entry => entry.key))
/** Arrow keys, Home and End move between the sub-tabs (and open the one reached), as in a tab list. */
function onTabKey(event: KeyboardEvent) {
  const keys = tabKeys.value
  const index = keys.indexOf(tab.value ?? '')
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  selectTab(keys[next])
  nextTick(() => document.getElementById(`templates-tab-${keys[next]}`)?.focus())
}
const tabLabel = (entry: { category: TemplateCategoryDto | null }) => entry.category?.name ?? de.printTemplates.fromProvider

// ---- search --------------------------------------------------------------
// Title, category and subcategory in every category the viewer sees (umlaut spellings and case aside). While a term is
// entered, the matches replace the sub-tabs, grouped by „Kategorie › Unterkategorie“ („Vom Träger“ last); clearing it
// returns to the sub-tab open before.
const search = ref('')
const searching = computed(() => search.value.trim() !== '')
const found = computed(() => templates.value.filter(template =>
  matchesSearch([template.title, template.category, template.subcategory], search.value)))
const foundGroups = computed(() => searchGroups(found.value, template =>
  (template.categoryId === null ? de.printTemplates.fromProvider : templatePath(template))))
/** The hints for Leitung and Träger: „nur Kita A, Kita B“, „nur Bären, Füchse“, „keine Gruppe mehr gewählt“. */
const hintsOf = (template: PrintTemplateDto) => targetHints(template.targets, { only: de.documentTargets.only, noGroup: de.documentTargets.noGroup, noFacility: de.documentTargets.noFacility })

// ---- upload and change ---------------------------------------------------
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

function openNew() {
  editing.value = null
  resetFile()
  // The open sub-tab's category (and small tab's subcategory) is the likely one; with a single category there is nothing
  // to choose.
  const tops = topCategories(categories.value)
  const preset = current.value?.category?.id ?? (tops.length === 1 ? tops[0]!.id : undefined)
  const presetName = current.value?.category?.name ?? current.value?.templates[0]?.category ?? ''
  const presetSub = current.value?.subcategories.find(sub => subcategoryChip(sub.id) === chip.value)
  // For all facilities: as restricted as the open sub-tab's category and small tab's subcategory, the stricter of both
  // (none for „Vom Träger“).
  const visibility = defaultGlobalVisibility(current.value?.category, categoryLevels.value, presetSub)
  Object.assign(form, {
    title: '', categoryId: preset, subcategoryId: presetSub?.id ?? 0, targets: emptyTargets(), categoryName: presetName,
    subcategoryName: presetSub?.name ?? '', visibility,
  })
  targetsTouched.value = false
  open.value = true
  loadTargetOptions()
}

function openEdit(template: PrintTemplateDto) {
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
async function save() {
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

// ---- order (▲/▼) --------------------------------------------------------
/**
 * One place up or down in a list (a subcategory, the templates directly in the category, or „Vom Träger“): the server
 * takes the list's whole order as the editor sees it.
 */
async function move(group: ItemGroup<TemplateCategoryDto, PrintTemplateDto>, index: number, direction: -1 | 1) {
  const id = group.items[index]?.id
  const ids = moveInList(group.items.map(template => template.id), index, direction)
  if (id === undefined || !ids) return
  const body = { categoryId: group.groupId, ids }
  if (await run(() => $fetch<unknown>('/api/print-templates/order', { method: 'POST', body }))) focusOrderArrow(`template-${id}`, direction)
}

async function remove(template: PrintTemplateDto) {
  if (await confirm(de.printTemplates.confirmDelete(template.title))) {
    run(() => $fetch<unknown>(`/api/print-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <p class="min-w-60 flex-1 text-sm text-gray-600">
        {{ de.printTemplates.intro }}
        <template v-if="fillTargets.length && templates.length"> {{ de.pdfFill.libraryHint }}</template>
      </p>
      <div v-if="canEdit" class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="outline" icon="i-lucide-folder-cog" :label="de.printTemplates.manageCategories" @click="managing = true" />
        <UButton icon="i-lucide-upload" :label="de.printTemplates.upload" @click="openNew" />
      </div>
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <p v-else-if="!tabs.length" class="text-sm text-gray-500">{{ de.printTemplates.none }}</p>

    <template v-else>
      <UInput v-model="search" icon="i-lucide-search" :placeholder="de.printTemplates.searchPlaceholder" :aria-label="de.printTemplates.search" class="w-full max-w-md" maxlength="100" />
      <!-- Searching: the matches of every category, grouped by „Kategorie › Unterkategorie“, instead of the sub-tabs. -->
      <section v-if="searching" class="space-y-4" :aria-label="de.printTemplates.search">
        <p class="text-sm text-gray-600" role="status">{{ de.printTemplates.searchResults(found.length) }}</p>
        <p v-if="!found.length" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ de.printTemplates.noMatch }}</p>
        <SubcategorySection
          v-for="group in foundGroups" :key="group.key" :section-id="`templates-found-${group.key}`" :title="group.heading"
          :count="de.printTemplates.categories.templateCount(group.items.length)"
        >
          <ul class="divide-y divide-gray-100">
            <li v-for="template in group.items" :key="template.id" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <UIcon name="i-lucide-file-text" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
              <div class="flex min-w-48 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-medium">{{ template.title }}</span>
                <span v-if="template.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="de.printTemplates.globalHint">{{ template.allFacilities ? de.printTemplates.global : de.printTemplates.ownerBadge }}</span>
                <span v-for="hint in hintsOf(template)" :key="hint" class="whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">{{ hint }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-1">
                <UButton
                  :to="templateFileUrl(template.id)" target="_blank" external size="sm" color="neutral" variant="outline"
                  icon="i-lucide-printer" :label="de.printTemplates.open"
                />
                <UButton
                  v-if="fillTargets.length" size="sm" color="neutral" variant="outline" icon="i-lucide-pencil-line"
                  :label="de.pdfFill.fill" @click="startFill(template)"
                />
                <UButton v-if="canEdit && template.canEdit" size="sm" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="de.common.edit" :disabled="busy" @click="openEdit(template)" />
              </div>
            </li>
          </ul>
        </SubcategorySection>
      </section>
      <div v-if="!searching" role="tablist" :aria-label="de.printTemplates.tabsLabel" class="flex flex-wrap gap-1.5">
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
          <span v-else class="text-gray-600">{{ de.printTemplates.fromProviderHint }}</span>
        </p>
        <p v-if="!shownCount" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ emptyText }}</p>
        <!-- „Alle“: one section per list („Allgemein“ first), each folding up; otherwise the one list. -->
        <div v-else class="space-y-5">
          <SubcategorySection
            v-for="group in shown" :key="group.key" :section-id="`templates-section-${group.key}`" :title="sections ? groupName(group) : null"
            :count="de.printTemplates.categories.templateCount(group.items.length)" :badge="group.subcategory ? badgeOf(group.subcategory.visibility) : ''"
            :collapsible="sections" :open="isOpen(group.key)" @update:open="setOpen(group.key, $event)"
          >
            <ul class="divide-y divide-gray-100" :class="sections ? '' : 'rounded-lg bg-white ring-1 ring-gray-200'">
              <li v-for="(template, index) in group.items" :key="template.id" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <UIcon name="i-lucide-file-text" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
                <!-- At least 12rem for the text; on a narrow screen the buttons move to their own line instead. -->
                <div class="min-w-48 flex-1 space-y-0.5">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="font-medium">{{ template.title }}</span>
                    <span v-if="template.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="de.printTemplates.globalHint">{{ template.allFacilities ? de.printTemplates.global : de.printTemplates.ownerBadge }}</span>
                    <span v-if="!current.category" class="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{{ templatePath(template) }}</span>
                    <!-- „Gilt für“, for Leitung and Träger: „nur Kita A“, „nur Bären, Füchse“. -->
                    <span v-for="hint in hintsOf(template)" :key="hint" class="whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">{{ hint }}</span>
                  </div>
                  <p class="text-xs text-gray-500">
                    {{ de.printTemplates.uploadedAt(formatDate(berlinDay(template.uploadedAt))) }}
                    <template v-if="berlinDay(template.updatedAt) !== berlinDay(template.uploadedAt)"> · {{ de.printTemplates.updatedAt(formatDate(berlinDay(template.updatedAt))) }}</template>
                    · {{ formatSize(template.size) }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-1">
                  <UButton
                    :to="templateFileUrl(template.id)" target="_blank" external size="sm" color="neutral" variant="outline"
                    icon="i-lucide-printer" :label="de.printTemplates.open"
                  />
                  <UButton
                    v-if="fillTargets.length" size="sm" color="neutral" variant="outline" icon="i-lucide-pencil-line"
                    :label="de.pdfFill.fill" @click="startFill(template)"
                  />
                  <template v-if="canEdit && template.canEdit">
                    <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="de.common.edit" :disabled="busy" @click="openEdit(template)" />
                    <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" :disabled="busy" @click="remove(template)" />
                  </template>
                  <!-- ▲/▼ last, so they stay in the same place in every row; 40 px for a finger. -->
                  <span v-if="canEdit" role="group" :aria-label="`${de.printTemplates.order}: ${template.title}`" class="flex items-center gap-1">
                    <UButton
                      :id="orderArrowId(`template-${template.id}`, -1)" color="neutral" variant="ghost" icon="i-lucide-arrow-up"
                      class="min-h-10 min-w-10 justify-center" :aria-label="`${de.printTemplates.moveUp}: ${template.title}`"
                      :title="de.printTemplates.moveUp" :disabled="busy || index === 0" @click="move(group, index, -1)"
                    />
                    <UButton
                      :id="orderArrowId(`template-${template.id}`, 1)" color="neutral" variant="ghost" icon="i-lucide-arrow-down"
                      class="min-h-10 min-w-10 justify-center" :aria-label="`${de.printTemplates.moveDown}: ${template.title}`"
                      :title="de.printTemplates.moveDown" :disabled="busy || index === group.items.length - 1" @click="move(group, index, 1)"
                    />
                  </span>
                </div>
              </li>
            </ul>
          </SubcategorySection>
        </div>
      </section>
    </template>

    <UModal v-if="canEdit" v-model:open="open" :title="editing === null ? de.printTemplates.upload : de.printTemplates.edit">
      <template #body>
        <UAlert v-if="!categories.length && !forAll && !canEditGlobal" color="warning" variant="soft" :title="de.printTemplates.noCategory" />
        <form v-else class="grid gap-3" @submit.prevent="save">
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
                <USelect v-model="form.categoryId" :items="categoryItems" :placeholder="de.printTemplates.categoryPlaceholder" class="w-full" />
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

    <TemplatesCategoryManager v-if="canEdit" v-model:open="managing" :categories="categories" :levels="categoryLevels" :refresh="refresh" />
    <PdfFillStart v-if="filling" v-model:open="fillOpen" :template="filling" />
  </div>
</template>
