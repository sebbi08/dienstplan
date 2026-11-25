<script setup lang="ts">
import { exampleKindOf } from '#shared/domain/formCategories'
import { FORM_KINDS, FORM_LIMITS, type FormKind, type FormSubject } from '#shared/domain/forms'
import { matchesSearch } from '#shared/domain/search'
import type { FormTemplateCategoryDto, FormTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { focusOrderArrow, orderArrowId } from '~/utils/orderArrows'
import {
  filedCategoryId, itemGroups, searchGroups, subcategoriesOf, subcategoryChip, subcategoryItems, topCategories, type ItemGroup,
} from '~/utils/subcategories'
import { moveInList } from '~/utils/consentSettings'

/**
 * Dokumente → Bögen, the list: the facility's own categories as tabs (and „Ohne Kategorie“ while templates lie in none),
 * the subcategories of the open one as small tabs („Alle“ shows a section per list, folding up), ▲/▼ within each list,
 * the search over the names of every category, „Neue Vorlage“ (name, „Wofür“, category and subcategory; the open tab's
 * by default), „Verschieben“ into another (sub)category and „Kategorien verwalten“. Each row shows „Wofür“ as a badge
 * (fixed after creation). Archived templates of the tab are listed below, folded. `open` opens the editor.
 */
const props = defineProps<{ templates: FormTemplateDto[]; categories: FormTemplateCategoryDto[]; refresh: () => Promise<unknown> }>()
const emit = defineEmits<{ open: [id: number] }>()
const t = de.forms
const c = de.forms.categories
const run = useAction(props.refresh)
const confirm = useConfirm()
const toast = useToast()

// ---- tabs ----------------------------------------------------------------
const NONE_TAB = 'none'
const TAB_MEMORY = 'dienstplan.formTemplatesTab'
interface Tab { key: string; category: FormTemplateCategoryDto | null }
const tabs = computed<Tab[]>(() => [
  ...topCategories(props.categories).map(category => ({ key: `cat-${category.id}`, category })),
  ...(props.templates.some(template => template.categoryId === null) ? [{ key: NONE_TAB, category: null }] : []),
])
const wantedTab = ref<string | null>(null)
const tab = computed(() => tabs.value.find(entry => entry.key === wantedTab.value)?.key ?? tabs.value[0]?.key ?? null)
const current = computed(() => tabs.value.find(entry => entry.key === tab.value) ?? null)
function selectTab(key: string) {
  wantedTab.value = key
  try {
    localStorage.setItem(TAB_MEMORY, key)
  }
  catch {
    // Not remembered; switching still works on this page.
  }
}
function readTabMemory() {
  try {
    wantedTab.value = localStorage.getItem(TAB_MEMORY)
  }
  catch {
    wantedTab.value = null
  }
}
/** Arrow keys, Home and End move between the tabs (and open the one reached), as in a tab list. */
function onTabKey(event: KeyboardEvent) {
  const keys = tabs.value.map(entry => entry.key)
  const index = keys.indexOf(tab.value ?? '')
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  selectTab(keys[next])
  nextTick(() => document.getElementById(`form-templates-tab-${keys[next]}`)?.focus())
}

const inTab = (template: FormTemplateDto) => (current.value?.category ? template.categoryId === current.value.category.id : template.categoryId === null)
const activeInTab = computed(() => props.templates.filter(template => !template.archived && inTab(template)))
const archivedInTab = computed(() => props.templates.filter(template => template.archived && inTab(template)))

// ---- subcategories ---------------------------------------------------------
const groups = computed(() => (current.value
  ? itemGroups(current.value.category, subcategoriesOf(props.categories, current.value.category?.id ?? null), activeInTab.value)
  : []))
const { chips, chip, selectChip, shown, sections, isOpen, setOpen, readMemory: readSubMemory } = useSubcategoryView(
  { chips: 'dienstplan.formTemplatesSubTab', collapsed: 'dienstplan.formTemplatesCollapsed' }, () => current.value?.key ?? null, groups,
)
const shownCount = computed(() => shown.value.reduce((sum, group) => sum + group.items.length, 0))
const groupName = (group: ItemGroup<FormTemplateCategoryDto, FormTemplateDto>) => group.subcategory?.name ?? c.generalChip
const emptyText = computed(() => (current.value?.category && subcategoriesOf(props.categories, current.value.category.id)
  .some(sub => subcategoryChip(sub.id) === chip.value) ? c.emptySub : c.empty))
function readMemory() {
  readTabMemory()
  readSubMemory()
}
if (import.meta.client && !useNuxtApp().isHydrating) readMemory()
else onMounted(readMemory)

// ---- search ----------------------------------------------------------------
const search = ref('')
const searching = computed(() => search.value.trim() !== '')
const found = computed(() => props.templates.filter(template => matchesSearch([template.name, template.category ?? ''], search.value)))
const foundGroups = computed(() => searchGroups(found.value, template => template.category ?? c.none))

// ---- actions -----------------------------------------------------------------
const copy = (template: FormTemplateDto) =>
  run(() => $fetch<unknown>(`/api/form-templates/${template.id}/copy`, { method: 'POST' }), t.copied)
const setArchived = (template: FormTemplateDto, value: boolean) =>
  run(() => $fetch<unknown>(`/api/form-templates/${template.id}`, { method: 'PUT', body: { archived: value } }),
    value ? t.archivedDone : t.unarchivedDone)
async function remove(template: FormTemplateDto) {
  if (await confirm(t.deleteTemplateConfirm(template.name))) {
    await run(() => $fetch<unknown>(`/api/form-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
/** One place up or down within its list (the category's own templates or a subcategory's); archived ones keep their place. */
const { busy: ordering, run: runOrder } = useBusyAction(props.refresh)
async function move(group: ItemGroup<FormTemplateCategoryDto, FormTemplateDto>, index: number, direction: -1 | 1) {
  const id = group.items[index]?.id
  const ids = moveInList(group.items.map(template => template.id), index, direction)
  if (id === undefined || !ids) return
  if (await runOrder(() => $fetch<unknown>('/api/form-templates/order', { method: 'POST', body: { categoryId: group.groupId, ids } }))) {
    focusOrderArrow(`form-template-${id}`, direction)
  }
}

// ---- new template / move to another category ----------------------------------
const managing = ref(false)
const dialogOpen = ref(false)
/** null = a new template, else the one moved. */
const moving = ref<FormTemplateDto | null>(null)
const subjectItems = (['child', 'employee'] as const).map(value => ({ label: t.subjects[value], value }))
const kindItems = FORM_KINDS.map(value => ({ label: t.forKinds[value], value }))
const categoryItems = computed(() => [{ label: c.categoryNone, value: 0 }, ...topCategories(props.categories).map(category => ({ label: category.name, value: category.id }))])
/** `kind` undefined until picked: preset only in an example category (Unfälle → für Unfälle …), see exampleKindOf. */
const draft = reactive<{ name: string; kind: FormKind | undefined; selfAssessment: boolean; subject: FormSubject; categoryId: number; subcategoryId: number }>({
  name: '', kind: undefined, selfAssessment: false, subject: 'child', categoryId: 0, subcategoryId: 0,
})
const subItems = computed(() => subcategoryItems(props.categories, draft.categoryId || undefined, c.subNone))
watch(() => draft.categoryId, () => {
  if (!subItems.value.some(item => item.value === draft.subcategoryId)) draft.subcategoryId = 0
})
/** The open tab's category and subcategory (a subcategory's small tab), else none. */
function placeOfTab(): { categoryId: number; subcategoryId: number } {
  const categoryId = current.value?.category?.id ?? 0
  const sub = subcategoriesOf(props.categories, categoryId || null).find(entry => subcategoryChip(entry.id) === chip.value)
  return { categoryId, subcategoryId: sub?.id ?? 0 }
}
function startNew() {
  moving.value = null
  Object.assign(draft, { name: '', kind: exampleKindOf(current.value?.category?.name) ?? undefined, selfAssessment: false, subject: 'child', ...placeOfTab() })
  dialogOpen.value = true
}
function startMove(template: FormTemplateDto) {
  moving.value = template
  Object.assign(draft, { name: template.name, kind: template.kind, categoryId: template.categoryId ?? 0, subcategoryId: template.subcategoryId ?? 0 })
  dialogOpen.value = true
}
const saving = ref(false)
async function saveDialog() {
  if (saving.value) return
  if (!moving.value && !draft.name.trim()) return void toast.add({ title: t.nameFirst, color: 'warning' })
  if (!moving.value && !draft.kind) return void toast.add({ title: t.kindFirst, color: 'warning' })
  const categoryId = filedCategoryId(draft.categoryId || undefined, draft.subcategoryId) ?? null
  saving.value = true
  try {
    if (moving.value) {
      await $fetch<unknown>(`/api/form-templates/${moving.value.id}`, { method: 'PUT', body: { categoryId } })
      await props.refresh()
      toast.add({ title: t.moved, color: 'success' })
      dialogOpen.value = false
    }
    else {
      const { id } = await $fetch<{ id: number }>('/api/form-templates', {
        method: 'POST',
        body: {
          kind: draft.kind, name: draft.name, selfAssessment: draft.kind === 'staff' && draft.selfAssessment,
          subject: draft.kind === 'accident' ? draft.subject : null, categoryId,
        },
      })
      await props.refresh()
      toast.add({ title: t.created, color: 'success' })
      dialogOpen.value = false
      emit('open', id)
    }
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="min-w-0 space-y-3">
    <p class="text-sm text-gray-600">{{ t.templatesHint }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <UInput v-model="search" icon="i-lucide-search" :placeholder="t.searchPlaceholder" :aria-label="t.search" class="w-full max-w-md" maxlength="100" />
      <div class="flex flex-wrap gap-2 sm:ml-auto">
        <UButton icon="i-lucide-plus" :label="t.newTemplate" @click="startNew" />
        <UButton color="neutral" variant="outline" icon="i-lucide-folder-cog" :label="c.manage" @click="managing = true" />
      </div>
    </div>

    <!-- Searching: the matches of every category, grouped by „Kategorie › Unterkategorie“. -->
    <section v-if="searching" class="space-y-3" :aria-label="t.search">
      <p class="text-sm text-gray-600" role="status">{{ t.searchResults(found.length) }}</p>
      <p v-if="!found.length" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ t.noMatch }}</p>
      <SubcategorySection
        v-for="group in foundGroups" :key="group.key" :section-id="`form-templates-found-${group.key}`" :title="group.heading"
        :count="c.templateCount(group.items.length)"
      >
        <ul class="divide-y divide-gray-100">
          <li v-for="template in group.items" :key="template.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <div class="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2">
              <span class="font-medium break-words" :class="template.archived ? 'text-gray-600' : ''">{{ template.name }}</span>
              <UBadge color="neutral" variant="outline" size="sm" :label="t.forKinds[template.kind]" />
              <UBadge v-if="template.archived" color="neutral" variant="soft" size="sm" :label="t.archivedBadge" />
            </div>
            <div class="flex flex-wrap gap-1">
              <UButton v-if="!template.archived" size="sm" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t.edit" @click="emit('open', template.id)" />
              <UButton v-else size="sm" color="neutral" variant="outline" icon="i-lucide-archive-restore" :label="t.unarchive" @click="setArchived(template, false)" />
              <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" :aria-label="`${t.copy}: ${template.name}`" :title="t.copy" @click="copy(template)" />
            </div>
          </li>
        </ul>
      </SubcategorySection>
    </section>

    <template v-else>
      <p v-if="!tabs.length" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ c.noneYet }}</p>
      <div v-else role="tablist" :aria-label="c.tabsLabel" class="flex flex-wrap gap-1.5">
        <button
          v-for="entry in tabs" :id="`form-templates-tab-${entry.key}`" :key="entry.key" type="button" role="tab"
          :aria-selected="tab === entry.key" :tabindex="tab === entry.key ? 0 : -1" aria-controls="form-templates-tab-panel"
          class="min-h-11 rounded-full px-4 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="tab === entry.key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
          @click="selectTab(entry.key)" @keydown="onTabKey"
        >
          {{ entry.category?.name ?? c.none }}
        </button>
      </div>

      <section v-if="current" id="form-templates-tab-panel" role="tabpanel" :aria-labelledby="`form-templates-tab-${current.key}`" class="space-y-3">
        <SubcategoryPanel
          v-if="current.category && chips.length" :model-value="chip" :chips="chips" id-prefix="form-templates-chip" controls="form-templates-tab-panel"
          :label="c.subTabsLabel(current.category.name)" :all-label="c.allChip" :general-label="c.generalChip" @update:model-value="selectChip"
        />
        <p v-if="!current.category" class="text-sm text-gray-600">{{ c.noneHint }}</p>
        <p v-if="!shownCount" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ emptyText }}</p>
        <div v-else class="space-y-5">
          <SubcategorySection
            v-for="group in shown" :key="group.key" :section-id="`form-templates-section-${group.key}`" :title="sections ? groupName(group) : null"
            :count="c.templateCount(group.items.length)" :collapsible="sections" :open="isOpen(group.key)" @update:open="setOpen(group.key, $event)"
          >
            <ul class="divide-y divide-gray-100" :class="sections ? '' : 'rounded-lg bg-white ring-1 ring-gray-200'">
              <li v-for="(template, index) in group.items" :key="template.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <div class="min-w-0 flex-1 basis-48">
                  <div class="font-medium break-words">{{ template.name }}</div>
                  <div class="flex flex-wrap gap-1">
                    <UBadge color="neutral" variant="outline" size="sm" :label="t.forKinds[template.kind]" />
                    <UBadge v-if="template.starterKey" color="neutral" variant="soft" size="sm" :label="t.starter" />
                    <UBadge v-if="template.selfAssessment" color="info" variant="soft" size="sm" :label="t.selfAssessmentBadge" />
                    <UBadge v-if="template.subject" color="neutral" variant="outline" size="sm" :label="t.subjectBadge(t.subjects[template.subject])" />
                  </div>
                </div>
                <div class="flex flex-wrap gap-1">
                  <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t.edit" @click="emit('open', template.id)" />
                  <UButton
                    size="sm" color="neutral" variant="ghost" icon="i-lucide-printer" :to="`/admin/print/form-templates/${template.id}`"
                    target="_blank" :aria-label="`${t.printBlank}: ${template.name}`" :title="t.printBlank"
                  />
                  <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" :aria-label="`${t.copy}: ${template.name}`" :title="t.copy" @click="copy(template)" />
                  <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-folder-input" :aria-label="`${t.moveTo}: ${template.name}`" :title="t.moveTo" @click="startMove(template)" />
                  <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-archive" :aria-label="`${t.archive}: ${template.name}`" :title="t.archive" @click="setArchived(template, true)" />
                  <UButton
                    size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${de.common.delete}: ${template.name}`"
                    :disabled="template.inUse" :title="template.inUse ? t.inUseHint : de.common.delete" @click="remove(template)"
                  />
                  <span role="group" :aria-label="`${t.order}: ${template.name}`" class="flex items-center gap-1">
                    <UButton
                      :id="orderArrowId(`form-template-${template.id}`, -1)" color="neutral" variant="ghost" icon="i-lucide-arrow-up"
                      class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveUp}: ${template.name}`" :title="t.moveUp"
                      :disabled="ordering || index === 0" @click="move(group, index, -1)"
                    />
                    <UButton
                      :id="orderArrowId(`form-template-${template.id}`, 1)" color="neutral" variant="ghost" icon="i-lucide-arrow-down"
                      class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveDown}: ${template.name}`" :title="t.moveDown"
                      :disabled="ordering || index === group.items.length - 1" @click="move(group, index, 1)"
                    />
                  </span>
                </div>
              </li>
            </ul>
          </SubcategorySection>
        </div>

        <details v-if="archivedInTab.length" class="rounded-lg bg-white px-4 py-2 ring-1 ring-gray-200">
          <summary class="cursor-pointer text-sm font-medium text-gray-700">{{ t.archivedList(archivedInTab.length) }}</summary>
          <ul class="mt-1 divide-y divide-gray-100">
            <li v-for="template in archivedInTab" :key="template.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <div class="min-w-0 flex-1 basis-48 break-words text-gray-600">
                {{ template.name }} <span v-if="template.subcategoryId" class="text-xs">· {{ template.category }}</span>
                <UBadge color="neutral" variant="outline" size="sm" class="ml-1" :label="t.forKinds[template.kind]" />
              </div>
              <div class="flex flex-wrap gap-1">
                <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-archive-restore" :label="t.unarchive" @click="setArchived(template, false)" />
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" :label="t.copy" @click="copy(template)" />
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-folder-input" :aria-label="`${t.moveTo}: ${template.name}`" :title="t.moveTo" @click="startMove(template)" />
                <UButton
                  size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete"
                  :disabled="template.inUse" :title="template.inUse ? t.inUseHint : de.common.delete" @click="remove(template)"
                />
              </div>
            </li>
          </ul>
        </details>
      </section>
    </template>
    <p v-if="templates.some(template => template.inUse)" class="text-xs text-gray-500">{{ t.inUseHint }}</p>

    <UModal v-model:open="dialogOpen" :title="moving ? t.moveTitle(moving.name) : t.newTemplate">
      <template #body>
        <form class="grid gap-3" @submit.prevent="saveDialog">
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
            <USelect v-model="draft.categoryId" :items="categoryItems" class="w-full" />
          </UFormField>
          <UFormField v-if="draft.categoryId && subItems.length > 1" :label="c.subcategory">
            <USelect v-model="draft.subcategoryId" :items="subItems" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="moving ? t.moveTo : t.createTemplate" :loading="saving" :disabled="saving" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="dialogOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
    <FormsCategoryManager v-model:open="managing" :categories="categories" :refresh="refresh" />
  </div>
</template>
