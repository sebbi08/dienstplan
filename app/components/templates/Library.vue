<script setup lang="ts">
import { TEMPLATE_VISIBILITIES, visibleTemplateLevels, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { PrintTemplateDto, PrintTemplateScope, TemplateCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { moveInList } from '~/utils/consentSettings'
import { formatDate } from '~/utils/format'
import { focusOrderArrow, orderArrowId } from '~/utils/orderArrows'
import { fillKinds } from '~/utils/pdfFill'
import {
  berlinDay, chosenTemplateTab, defaultGlobalVisibility, readTemplateTabMemory, sameCategoryName, templateFileUrl, templateTabs,
  titleFromFileName, writeTemplateTabMemory,
} from '~/utils/printTemplates'

/**
 * „Dokumente“ → „Vorlagen“: blank PDF forms to open and print, one sub-tab per category of the facility (in its order,
 * only those the viewer sees; the server filters) and „Vom Träger“ for templates for all facilities whose category name
 * the facility has no category of. Whoever may edit templates (printTemplates.edit: Träger and Leitung by default, a
 * Mitarbeiter with „Vorlagen bearbeiten“) uploads and maintains them and the facility's categories, everyone else and
 * the tablet (no unlock, they are no child data) only open them. The device remembers the last sub-tab. Editors order
 * the templates of a sub-tab with ▲/▼ (this facility's order, also for the Träger's templates); everyone sees that order.
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
const categoryItems = computed(() => categories.value.map(category => ({ label: category.name, value: category.id })))
const refresh = () => Promise.all([refreshTemplates(), refreshCategories()])

// ---- sub-tabs ------------------------------------------------------------
const wantedTab = ref<string | null>(null)
const tab = computed(() => chosenTemplateTab(tabs.value, wantedTab.value))
const current = computed(() => tabs.value.find(entry => entry.key === tab.value) ?? null)
// The device's memory is read after mounting on a full page load (so the server's page matches), at once otherwise.
if (import.meta.client && !useNuxtApp().isHydrating) wantedTab.value = readTemplateTabMemory()
else onMounted(() => { wantedTab.value = readTemplateTabMemory() })
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
const form = reactive<{
  title: string; categoryId: number | undefined; scope: PrintTemplateScope; categoryName: string; visibility: TemplateVisibility
}>({ title: '', categoryId: undefined, scope: 'facility', categoryName: '', visibility: 'all' })
/** The title the last chosen file suggested; a title typed by hand is not overwritten by the next file. */
let suggestedTitle = ''
/** For all facilities: filed by category name (with the names the facilities use as suggestions) and its visibility. */
const forAll = computed(() => (editing.value ? editing.value.global : form.scope === 'all'))

const scopeItems = computed(() => [
  { label: activeName.value ? de.printTemplates.scopeFacility(activeName.value) : de.printTemplates.scopeThisFacility, value: 'facility' },
  { label: de.printTemplates.scopeAll, value: 'all' },
])
const visibilityItems = computed(() => TEMPLATE_VISIBILITIES.filter(level => categoryLevels.value.includes(level))
  .map(level => ({ label: de.printTemplates.categories.visibilities[level], value: level })))
// The category names the facilities use, loaded afresh each time the Träger files a template for all facilities (so a
// name typed for the last upload is offered too).
const categoryNames = ref<string[]>([])
async function loadCategoryNames() {
  if (!canEditGlobal.value) return
  categoryNames.value = await $fetch<string[]>('/api/template-categories/names').catch(() => categoryNames.value)
}
watch(forAll, (value) => {
  if (value && open.value) loadCategoryNames()
})
// A new template for all facilities starts with the visibility of the facility's category of the typed (or chosen) name,
// so one meant for a restricted category is not shown to everyone where a facility lacks that category. Can be changed.
watch(() => form.categoryName, (name) => {
  if (editing.value !== null || !open.value) return
  const match = categories.value.find(category => sameCategoryName(category.name, name))
  if (match) form.visibility = defaultGlobalVisibility(match, categoryLevels.value)
})

function resetFile() {
  file.value = null
  suggestedTitle = ''
  if (fileInput.value) fileInput.value.value = ''
}

function openNew() {
  editing.value = null
  resetFile()
  // The open sub-tab's category is the likely one; with a single category there is nothing to choose.
  const preset = current.value?.category?.id ?? (categories.value.length === 1 ? categories.value[0]!.id : undefined)
  const presetName = current.value?.category?.name ?? current.value?.templates[0]?.category ?? ''
  // For all facilities: as restricted as the open sub-tab's category (none for „Vom Träger“).
  const visibility = defaultGlobalVisibility(current.value?.category, categoryLevels.value)
  Object.assign(form, { title: '', categoryId: preset, scope: 'facility', categoryName: presetName, visibility })
  open.value = true
}

function openEdit(template: PrintTemplateDto) {
  editing.value = template
  resetFile()
  Object.assign(form, {
    title: template.title, categoryId: template.categoryId ?? undefined, scope: template.global ? 'all' : 'facility',
    categoryName: template.globalCategoryName ?? '', visibility: template.globalVisibility ?? 'all',
  })
  open.value = true
  if (template.global) loadCategoryNames()
}

function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  if (!file.value || editing.value !== null) return
  if (form.title.trim() === '' || form.title === suggestedTitle) form.title = titleFromFileName(file.value.name)
  suggestedTitle = form.title
}

/** Fails early instead of after a long upload; the server checks the size and the real file type again. */
function checkFile(chosen: File): boolean {
  if (chosen.size > MAX_DOCUMENT_BYTES) {
    toast.add({ title: de.errors.document_too_large, color: 'error' })
    return false
  }
  return true
}

function fileBody(chosen: File): FormData {
  const body = new FormData()
  body.append('file', chosen)
  return body
}

/** The category part of the form: a category of the facility, or for all facilities the name and the visibility. */
function filing(): { categoryId: number } | { categoryName: string; visibility: TemplateVisibility } | null {
  if (forAll.value) {
    if (form.categoryName.trim() !== '') return { categoryName: form.categoryName, visibility: form.visibility }
    toast.add({ title: de.errors.template_category_name_required, color: 'error' })
    return null
  }
  if (form.categoryId !== undefined) return { categoryId: form.categoryId }
  toast.add({ title: de.errors.template_category_invalid, color: 'error' })
  return null
}

/** The note at a category that not everyone sees. */
const badgeOf = (visibility: TemplateVisibility) => (visibility === 'all' ? '' : de.printTemplates.visibilityBadge[visibility])

async function save() {
  const chosen = file.value
  const fields = filing()
  if (!fields) return
  if (editing.value === null) {
    if (!chosen) return void toast.add({ title: de.errors.file_required, color: 'error' })
    if (!checkFile(chosen)) return
    const body = fileBody(chosen)
    body.append('title', form.title)
    body.append('scope', forAll.value ? 'all' : 'facility')
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value))
    if (await run(() => $fetch<unknown>('/api/print-templates', { method: 'POST', body }), de.common.saved)) open.value = false
    return
  }
  const id = editing.value.id
  if (chosen && !checkFile(chosen)) return
  const saved = await run(async () => {
    await $fetch<unknown>(`/api/print-templates/${id}`, { method: 'PUT', body: { title: form.title, ...fields } })
    if (chosen) await $fetch<unknown>(`/api/print-templates/${id}/file`, { method: 'PUT', body: fileBody(chosen) })
  }, de.common.saved)
  if (saved) open.value = false
}

// ---- order (▲/▼) --------------------------------------------------------
/** One place up or down in the open sub-tab: the server takes the sub-tab's whole order as the editor sees it. */
async function move(index: number, direction: -1 | 1) {
  const entry = current.value
  const id = entry?.templates[index]?.id
  const ids = entry ? moveInList(entry.templates.map(template => template.id), index, direction) : null
  if (!entry || id === undefined || !ids) return
  const body = { categoryId: entry.category?.id ?? null, ids }
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
      <div role="tablist" :aria-label="de.printTemplates.tabsLabel" class="flex flex-wrap gap-1.5">
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
        v-if="current" id="templates-tab-panel" role="tabpanel" :aria-labelledby="`templates-tab-${current.key}`"
        class="rounded-lg bg-white ring-1 ring-gray-200"
      >
        <div
          v-if="!current.category || current.category.visibility !== 'all'"
          class="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 text-sm"
        >
          <span v-if="current.category" class="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
            {{ badgeOf(current.category.visibility) }}
          </span>
          <span v-else class="text-gray-600">{{ de.printTemplates.fromProviderHint }}</span>
        </div>
        <p v-if="!current.templates.length" class="px-4 py-3 text-sm text-gray-500">{{ de.printTemplates.emptyCategory }}</p>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="(template, index) in current.templates" :key="template.id" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <UIcon name="i-lucide-file-text" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
            <!-- At least 12rem for the text; on a narrow screen the buttons move to their own line instead. -->
            <div class="min-w-48 flex-1 space-y-0.5">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-medium">{{ template.title }}</span>
                <span v-if="template.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="de.printTemplates.globalHint">{{ de.printTemplates.global }}</span>
                <span v-if="!current.category" class="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{{ template.category }}</span>
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
                  :title="de.printTemplates.moveUp" :disabled="busy || index === 0" @click="move(index, -1)"
                />
                <UButton
                  :id="orderArrowId(`template-${template.id}`, 1)" color="neutral" variant="ghost" icon="i-lucide-arrow-down"
                  class="min-h-10 min-w-10 justify-center" :aria-label="`${de.printTemplates.moveDown}: ${template.title}`"
                  :title="de.printTemplates.moveDown" :disabled="busy || index === current.templates.length - 1" @click="move(index, 1)"
                />
              </span>
            </div>
          </li>
        </ul>
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
          <UFormField v-if="canEditGlobal && editing === null" :label="de.printTemplates.scope">
            <USelect v-model="form.scope" :items="scopeItems" class="w-full" />
          </UFormField>
          <template v-if="forAll">
            <UFormField :label="de.printTemplates.categoryName" :description="de.printTemplates.categoryNameHint" required>
              <UInput v-model="form.categoryName" maxlength="60" class="w-full" list="template-category-names" required autocomplete="off" />
              <datalist id="template-category-names">
                <option v-for="name in categoryNames" :key="name" :value="name" />
              </datalist>
            </UFormField>
            <UFormField :label="de.printTemplates.globalVisibility" :description="de.printTemplates.globalVisibilityHint">
              <USelect v-model="form.visibility" :items="visibilityItems" class="w-full" />
            </UFormField>
          </template>
          <template v-else>
            <UAlert v-if="!categories.length" color="warning" variant="soft" :title="de.printTemplates.noCategory" />
            <UFormField v-else :label="de.printTemplates.category" required>
              <USelect v-model="form.categoryId" :items="categoryItems" :placeholder="de.printTemplates.categoryPlaceholder" class="w-full" />
            </UFormField>
          </template>
          <div class="flex gap-2">
            <UButton type="submit" :label="editing === null ? de.printTemplates.upload : de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>

    <TemplatesCategoryManager v-if="canEdit" v-model:open="managing" :categories="categories" :levels="categoryLevels" :refresh="refresh" />
    <PdfFillStart v-if="filling" v-model:open="fillOpen" :template="filling" />
  </div>
</template>
