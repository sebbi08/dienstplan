<script setup lang="ts">
import type { KnowledgeCategoryDto, KnowledgeConfirmResultDto, KnowledgeDto, KnowledgeEntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatSize } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import {
  chosenKnowledgeTab, knowledgeFileUrl, knowledgePlace, knowledgeTabs, linkHost, movableEntries, readKnowledgeTabMemory, searchKnowledge,
  writeKnowledgeTabMemory,
} from '~/utils/knowledge'
import { focusOrderArrow, orderArrowId } from '~/utils/orderArrows'
import { berlinDay } from '~/utils/printTemplates'
import {
  chosenChip, groupHeadings, itemGroups, readChipMemory, shownGroups, subcategoryChip, subChips, writeChipMemory, type ItemGroup,
} from '~/utils/subcategories'

/**
 * „Dokumente“ → „Wissen“: PDFs, links to official pages and short formatted texts, one sub-tab per category of the
 * facility the viewer sees (the server filters by visibility) and „Vom Träger“ for entries for all facilities whose
 * category name the facility has no category of. A search looks into every category (title, description, text). An entry
 * with „Gelesen und verstanden erforderlich“ asks the reader to confirm: with an own account for its linked employee, at
 * the tablet with name and PIN. Whoever holds knowledge.manage adds and maintains entries and categories, orders the
 * facility's own entries with ▲/▼ and sees who confirmed. A category with subcategories shows a second row of small tabs
 * („Alle“, „Allgemein“, the subcategories; the device remembers the last one per category): „Alle“ lists the entries
 * in groups, one per subcategory, and ▲/▼ order within each group – the same list as the subcategory's own small tab.
 */
const t = de.knowledge
const { data, error, refresh: refreshKnowledge } = await useFetch<KnowledgeDto>('/api/knowledge', { key: 'knowledge' })
// The count at „Dokumente“ in the menu follows the confirmations (and new entries asking for one); only an account with a
// linked employee has one (the layout loads it for those alone).
const refresh = () => Promise.all([refreshKnowledge(), ...(confirmVia.value === 'account' ? [refreshNuxtData('knowledge-open-count')] : [])])
const entries = computed(() => data.value?.entries ?? [])
const categories = computed(() => data.value?.categories ?? [])
const canManage = computed(() => !!data.value?.canManage)
const confirmVia = computed(() => data.value?.confirmVia ?? null)
const openCount = computed(() => data.value?.openCount ?? 0)
const tabs = computed(() => knowledgeTabs(categories.value, entries.value))

// ---- sub-tabs and search ---------------------------------------------------
const wantedTab = ref<string | null>(null)
const tab = computed(() => chosenKnowledgeTab(tabs.value, wantedTab.value))
const current = computed(() => tabs.value.find(entry => entry.key === tab.value) ?? null)
// The device's memory is read after mounting on a full page load (so the server's page matches), at once otherwise.
const CHIP_MEMORY_KEY = 'dienstplan.knowledgeSubTab'
const chipMemory = ref<Record<string, string>>({})
function readMemory() {
  wantedTab.value = readKnowledgeTabMemory()
  chipMemory.value = readChipMemory(CHIP_MEMORY_KEY)
}
if (import.meta.client && !useNuxtApp().isHydrating) readMemory()
else onMounted(readMemory)
function selectTab(key: string) {
  wantedTab.value = key
  writeKnowledgeTabMemory(key)
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
  nextTick(() => document.getElementById(`knowledge-tab-${keys[next]}`)?.focus())
}
const search = ref('')
const searching = computed(() => search.value.trim() !== '')
const found = computed(() => searchKnowledge(entries.value, search.value))
// The second row of small tabs: „Alle“, „Allgemein“ and the subcategories of the open sub-tab's category.
type EntryGroup = ItemGroup<KnowledgeCategoryDto, KnowledgeEntryDto>
const groups = computed(() => (current.value ? itemGroups(current.value.category, current.value.subcategories, current.value.entries) : []))
const chips = computed(() => subChips(groups.value))
const chip = computed(() => chosenChip(chips.value, current.value ? chipMemory.value[current.value.key] : null))
function selectChip(key: string | null) {
  const entry = current.value
  if (!entry || key === null) return
  chipMemory.value = { ...chipMemory.value, [entry.key]: key }
  writeChipMemory(CHIP_MEMORY_KEY, entry.key, key)
}
/** The lists shown: the search's matches in every category (one list), else „Alle“ (every list) or the chosen one. */
const shownLists = computed((): EntryGroup[] => (searching.value
  ? [{ key: 'search', subcategory: null, groupId: null, items: found.value }]
  : shownGroups(groups.value, chip.value)))
const shownCount = computed(() => shownLists.value.reduce((sum, group) => sum + group.items.length, 0))
/** „Alle“ shows a heading over each list. */
const headings = computed(() => !searching.value && groupHeadings(chip.value))
const groupName = (group: EntryGroup) => group.subcategory?.name ?? t.generalChip
const emptyText = computed(() => {
  if (searching.value) return t.noMatch
  return current.value?.subcategories.some(sub => subcategoryChip(sub.id) === chip.value) ? t.emptySubcategory : t.emptyCategory
})
const categoryName = (entry: KnowledgeEntryDto) => knowledgePlace(categories.value, entry, t.fromProvider)
/** The cards shown, each with its list (for ▲/▼); in „Alle“ the first of each list carries the heading. */
const rows = computed(() => shownLists.value.flatMap(group => group.items.map((entry, index) => ({
  entry, group, heading: headings.value && index === 0,
}))))

// ---- reading -----------------------------------------------------------------
const expanded = ref(new Set<number>())
function toggle(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
const KIND_ICONS = { file: 'i-lucide-file-text', link: 'i-lucide-external-link', text: 'i-lucide-align-left' } as const
const day = (timestamp: string) => formatDate(berlinDay(timestamp))

// ---- confirming ------------------------------------------------------------
const { busy, run } = useBusyAction(refresh)
const confirm = useConfirm()
const toast = useToast()
const tabletEntry = ref<KnowledgeEntryDto | null>(null)
const tabletOpen = ref(false)
async function confirmRead(entry: KnowledgeEntryDto) {
  if (confirmVia.value === 'tablet') {
    tabletEntry.value = entry
    tabletOpen.value = true
    return
  }
  if (!(await confirm(t.confirmQuestion(entry.title), { confirmLabel: t.confirm, danger: false }))) return
  // The version shown: one changed meanwhile is refused (knowledge_entry_changed), and the list is loaded again to read it.
  const body = { version: entry.version }
  const done = await run(() => $fetch<KnowledgeConfirmResultDto>(`/api/knowledge/${entry.id}/confirm`, { method: 'POST', body }), t.confirmedToast)
  if (!done) await refresh()
}
function onTabletChanged(message: string) {
  toast.add({ title: message, color: 'error' })
  refresh()
}
function onTabletConfirmed(result: KnowledgeConfirmResultDto) {
  toast.add({ title: t.confirmedFor(result.name, day(result.confirmedAt)), color: 'success' })
  refresh()
}

// ---- maintaining -----------------------------------------------------------
const dialogOpen = ref(false)
const editing = ref<KnowledgeEntryDto | null>(null)
const managing = ref(false)
const overviewEntry = ref<KnowledgeEntryDto | null>(null)
const overviewOpen = ref(false)
function openDialog(entry: KnowledgeEntryDto | null) {
  editing.value = entry
  dialogOpen.value = true
}
function openOverview(entry: KnowledgeEntryDto) {
  overviewEntry.value = entry
  overviewOpen.value = true
}
async function remove(entry: KnowledgeEntryDto) {
  if (await confirm(t.confirmDelete(entry.title))) {
    run(() => $fetch<{ ok: boolean }>(`/api/knowledge/${entry.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
/** ▲/▼ among the facility's own entries of each list shown (a subcategory, or directly in the category); none in the search. */
const movable = computed(() => new Map(shownLists.value.map(group => [group.key, searching.value ? [] : movableEntries(group.items)])))
const movableIn = (group: EntryGroup) => movable.value.get(group.key) ?? []
async function move(entry: KnowledgeEntryDto, direction: -1 | 1) {
  const body = { direction: direction < 0 ? 'up' : 'down' }
  if (await run(() => $fetch<{ ok: boolean }>(`/api/knowledge/${entry.id}/move`, { method: 'POST', body }))) {
    focusOrderArrow(`knowledge-${entry.id}`, direction)
  }
}
const presetCategoryId = computed(() => current.value?.category?.id ?? null)
const presetSubcategoryId = computed(() => current.value?.subcategories.find(sub => subcategoryChip(sub.id) === chip.value)?.id ?? null)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <p class="min-w-60 flex-1 text-sm text-gray-600">{{ confirmVia === 'tablet' ? t.introTablet : canManage ? t.introManage : t.intro }}</p>
      <div v-if="canManage" class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="outline" icon="i-lucide-folder-cog" :label="t.manageCategories" @click="managing = true" />
        <UButton icon="i-lucide-plus" :label="t.add" @click="openDialog(null)" />
      </div>
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <template v-else>
      <UAlert v-if="openCount > 0" color="info" variant="soft" icon="i-lucide-book-check" :title="t.openCount(openCount)" />
      <UInput v-model="search" icon="i-lucide-search" :placeholder="t.searchPlaceholder" :aria-label="t.search" class="w-full max-w-md" maxlength="100" />

      <p v-if="!tabs.length" class="text-sm text-gray-500">{{ t.none }}</p>
      <div v-else-if="!searching" role="tablist" :aria-label="t.tabsLabel" class="flex flex-wrap gap-1.5">
        <button
          v-for="entry in tabs" :id="`knowledge-tab-${entry.key}`" :key="entry.key" type="button" role="tab"
          :aria-selected="tab === entry.key" :tabindex="tab === entry.key ? 0 : -1" aria-controls="knowledge-tab-panel"
          class="min-h-11 rounded-full px-4 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="tab === entry.key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
          @click="selectTab(entry.key)" @keydown="onTabKey"
        >
          {{ entry.category?.name ?? t.fromProvider }}
        </button>
      </div>
      <p v-else class="text-sm text-gray-600" role="status">{{ t.searchResults(found.length) }}</p>

      <section
        v-if="tabs.length || searching" id="knowledge-tab-panel" :role="searching ? undefined : 'tabpanel'"
        :aria-labelledby="!searching && current ? `knowledge-tab-${current.key}` : undefined" class="space-y-2"
      >
        <template v-if="!searching && current">
          <span v-if="current.category && current.category.visibility !== 'all'" class="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
            {{ t.visibilityBadge[current.category.visibility] }}
          </span>
          <p v-else-if="!current.category" class="text-sm text-gray-600">{{ t.fromProviderHint }}</p>
          <!-- Subcategories: „Alle“, „Allgemein“, each subcategory (wrapping on a narrow screen). -->
          <SubcategoryChips
            v-if="current.category && chips.length" :model-value="chip" :chips="chips" id-prefix="knowledge-chip"
            controls="knowledge-tab-panel" :label="t.subTabsLabel(current.category.name)" :all-label="t.allChip" :general-label="t.generalChip"
            @update:model-value="selectChip"
          />
        </template>
        <p v-if="!shownCount" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ emptyText }}</p>
        <ul v-else class="space-y-3">
          <li v-for="{ entry, group, heading } in rows" :key="entry.id" class="space-y-2">
            <!-- „Alle“: the first entry of each list carries the list's heading (its subcategory, or „Allgemein“). -->
            <h3 v-if="heading" class="flex flex-wrap items-center gap-2 pt-2 text-sm font-semibold text-gray-700">
              <UIcon name="i-lucide-folder" class="size-4 text-gray-400" aria-hidden="true" />{{ groupName(group) }}
              <span v-if="group.subcategory && group.subcategory.visibility !== 'all'" class="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">
                {{ t.visibilityBadge[group.subcategory.visibility] }}
              </span>
            </h3>
            <div class="flex flex-col gap-2 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">
              <div class="flex flex-wrap items-start gap-3">
                <UIcon :name="KIND_ICONS[entry.kind]" class="mt-0.5 size-5 shrink-0 text-gray-500" aria-hidden="true" />
                <div class="min-w-48 flex-1 space-y-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="font-semibold break-words">{{ entry.title }}</span>
                    <span class="sr-only">({{ t.kinds[entry.kind] }})</span>
                    <span v-if="entry.asOf" class="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{{ t.asOf(formatDate(entry.asOf)) }}</span>
                    <span v-if="searching" class="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{{ categoryName(entry) }}</span>
                    <span v-if="entry.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="t.globalHint">{{ t.global }}</span>
                    <span v-if="entry.needsConfirmation" class="whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">{{ t.needsConfirmationBadge }}</span>
                  </div>
                  <p v-if="entry.description" class="whitespace-pre-line text-gray-700">{{ entry.description }}</p>
                </div>
                <div class="flex flex-wrap items-center gap-1">
                  <UButton
                    v-if="entry.kind === 'file'" :to="knowledgeFileUrl(entry.id)" target="_blank" external size="sm" color="neutral" variant="outline"
                    icon="i-lucide-file-text" :label="t.open" :title="entry.fileSize ? formatSize(entry.fileSize) : undefined"
                  />
                  <a
                    v-else-if="entry.kind === 'link'" :href="entry.url" target="_blank" rel="noopener noreferrer"
                    class="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                  >
                    <UIcon name="i-lucide-external-link" class="size-4" aria-hidden="true" />{{ t.openLink(linkHost(entry.url)) }}
                  </a>
                  <UButton
                    v-else size="sm" color="neutral" variant="outline" :icon="expanded.has(entry.id) ? 'i-lucide-chevron-up' : 'i-lucide-book-open'"
                    :label="expanded.has(entry.id) ? t.collapse : t.read" :aria-expanded="expanded.has(entry.id)" :aria-controls="`knowledge-body-${entry.id}`"
                    @click="toggle(entry.id)"
                  />
                </div>
              </div>
              <div v-if="entry.kind === 'text' && expanded.has(entry.id)" :id="`knowledge-body-${entry.id}`" class="rounded bg-gray-50 p-3 text-gray-800">
                <FormsRichText :value="entry.body" />
              </div>

              <!-- „Gelesen und verstanden“ -->
              <div v-if="entry.needsConfirmation && confirmVia" class="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                <template v-if="confirmVia === 'account' && entry.myConfirmation?.state === 'confirmed'">
                  <UIcon name="i-lucide-circle-check" class="size-5 text-green-700" aria-hidden="true" />
                  <span class="text-green-800">{{ t.confirmed(day(entry.myConfirmation.confirmedAt!)) }}</span>
                </template>
                <template v-else>
                  <span v-if="entry.myConfirmation?.state === 'outdated'" class="min-w-48 flex-1 text-amber-800">
                    {{ t.outdated(day(entry.myConfirmation.confirmedAt!)) }}
                  </span>
                  <UButton icon="i-lucide-book-check" :label="t.confirm" :disabled="busy" class="min-h-10" @click="confirmRead(entry)" />
                </template>
              </div>
              <p v-else-if="entry.needsConfirmation && !confirmVia && !canManage" class="border-t border-gray-100 pt-2 text-xs text-gray-500">{{ t.noEmployeeHint }}</p>

              <div v-if="canManage" class="flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2">
                <span class="min-w-0 flex-1 text-xs text-gray-500">{{ t.kinds[entry.kind] }}<template v-if="entry.fileSize"> · {{ formatSize(entry.fileSize) }}</template></span>
                <UButton
                  v-if="entry.needsConfirmation" size="xs" color="neutral" variant="ghost" icon="i-lucide-list-checks" :label="t.whoConfirmed"
                  @click="openOverview(entry)"
                />
                <template v-if="entry.canEdit">
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="de.common.edit" :disabled="busy" @click="openDialog(entry)" />
                  <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" :disabled="busy" @click="remove(entry)" />
                </template>
                <!-- ▲/▼ last, so they stay in the same place in every row; 40 px for a finger. Only the facility's own entries. -->
                <span v-if="entry.canEdit && movableIn(group).includes(entry)" role="group" :aria-label="`${t.order}: ${entry.title}`" class="flex items-center gap-1">
                  <UButton
                    :id="orderArrowId(`knowledge-${entry.id}`, -1)" color="neutral" variant="ghost" icon="i-lucide-arrow-up"
                    class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveUp}: ${entry.title}`" :title="t.moveUp"
                    :disabled="busy || movableIn(group).indexOf(entry) === 0" @click="move(entry, -1)"
                  />
                  <UButton
                    :id="orderArrowId(`knowledge-${entry.id}`, 1)" color="neutral" variant="ghost" icon="i-lucide-arrow-down"
                    class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveDown}: ${entry.title}`" :title="t.moveDown"
                    :disabled="busy || movableIn(group).indexOf(entry) === movableIn(group).length - 1" @click="move(entry, 1)"
                  />
                </span>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <KnowledgeTabletConfirm v-if="confirmVia === 'tablet'" v-model:open="tabletOpen" :entry="tabletEntry" @confirmed="onTabletConfirmed" @changed="onTabletChanged" />
    <template v-if="canManage">
      <KnowledgeEntryDialog
        v-model:open="dialogOpen" :entry="editing" :categories="categories" :can-manage-global="!!data?.canManageGlobal"
        :preset-category-id="presetCategoryId" :preset-subcategory-id="presetSubcategoryId" :refresh="refresh"
      />
      <KnowledgeCategoryManager v-model:open="managing" :categories="categories" :refresh="refresh" />
      <KnowledgeConfirmations v-model:open="overviewOpen" :entry="overviewEntry" />
    </template>
  </div>
</template>
