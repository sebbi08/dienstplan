<script setup lang="ts">
import { addDays, todayIso } from '#shared/domain/dates'
import type { BirthdayDto, ChildListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import {
  areaOfTab, childrenTabVisible, defaultChildrenTab, readChildrenTabMemory, requestedChildrenTab, tabForArea, visibleChildrenAreas,
  writeChildrenTabMemory, type ChildrenArea, type ChildrenTab, type ChildrenTabMemory, type ChildrenViewer,
} from '~/utils/childrenAreas'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

const BIRTHDAY_WEEKS = 8

// In the office the account's rights, at the tablet those of the person who unlocked it.
const { rights, onTablet } = useChildRights()
const canCreate = computed(() => !!rights.value?.canEdit)
const isLeader = computed(() => !!rights.value?.isManager)
// Without both switches the tablet shows no planned children for people without manager rights.
const showPlanned = computed(() => !!rights.value && (rights.value.showWaitlist || rights.value.showFutureContracts))
const lookups = useChildLookups()
const { groupName, staff } = lookups

const { data: active, error } = await useFetch<ChildListItemDto[]>('/api/children', { query: { status: 'active' }, key: 'children-active' })
const { data: birthdayList } = await useFetch<BirthdayDto[]>('/api/children/birthdays', { key: 'children-birthdays' })
await lookups.ready

// The areas Heute, Kinder and Planung with their sub-tabs (app/utils/childrenAreas.ts): the Planung is for Leitung
// and Träger only (the server answers 403 to everybody else), the Personalschlüssel never at the tablet; without manager
// rights the planned children follow „Offen“ in Kinder, as far as the tablet's switches allow.
const viewer = computed<ChildrenViewer>(() => ({ isManager: isLeader.value, onTablet: onTablet.value, showPlanned: showPlanned.value }))
const areas = computed(() => visibleChildrenAreas(viewer.value))
const shown = (key: ChildrenTab) => childrenTabVisible(key, viewer.value)

// The page opens with Heute → Anwesenheit (spec Anwesenheit §3.1), with `?tab=` (an old tab key or an area) on that
// sub-tab, otherwise with the one this device used last.
const route = useRoute()
const fromAddress = () => requestedChildrenTab(route.query.tab, viewer.value)
const tab = ref<ChildrenTab>(fromAddress() ?? defaultChildrenTab(viewer.value))
const area = computed(() => areaOfTab(tab.value, viewer.value))
const areaTabs = computed(() => areas.value.find(entry => entry.area === area.value)?.tabs ?? [])
let memory: ChildrenTabMemory = { tab: null, last: {} }
function restore() {
  memory = readChildrenTabMemory()
  if (fromAddress()) return
  const remembered = requestedChildrenTab(memory.tab, viewer.value)
  if (remembered) tab.value = remembered
}
// The device's memory is read after mounting on a full page load (so the server's page matches), at once otherwise.
if (import.meta.client && !useNuxtApp().isHydrating) restore()
else onMounted(restore)

function selectTab(next: ChildrenTab) {
  tab.value = next
  memory = { tab: next, last: { ...memory.last, [areaOfTab(next, viewer.value)]: next } }
  writeChildrenTabMemory(memory)
}
function selectArea(next: ChildrenArea) {
  const target = tabForArea(next, viewer.value, memory.last)
  if (target) selectTab(target)
}
// A keep-alive at the tablet (or another person unlocking) can hide the open sub-tab: the area's first visible one, else
// the default.
watch(viewer, (current) => {
  if (!childrenTabVisible(tab.value, current)) tab.value = tabForArea(area.value, current) ?? defaultChildrenTab(current)
})

const TAB_LABELS: Record<ChildrenTab, string> = {
  attendance: de.attendance.tab, week: de.groupBook.tab, list: de.children.tabs.list, overview: de.children.tabs.overview,
  planned: de.children.tabs.planned, birthdays: de.children.tabs.birthdays, documents: de.children.tabs.documents,
  open: de.groupChange.openTab, occupancy: de.occupancy.tab, staffing: de.staffing.tab, archive: de.children.tabs.archive,
}
const AREA_ICONS: Record<ChildrenArea, string> = { today: 'i-lucide-sun', children: 'i-lucide-users', planning: 'i-lucide-calendar-range' }

/** Arrow keys, Home and End move between the tabs of a row (and open the one reached), as in a tab list. */
function onTabKey<T extends string>(event: KeyboardEvent, keys: readonly T[], current: T, select: (key: T) => void, idPrefix: string) {
  const index = keys.indexOf(current)
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  select(keys[next])
  nextTick(() => document.getElementById(`${idPrefix}${keys[next]}`)?.focus())
}
const areaKeys = computed(() => areas.value.map(entry => entry.area))

const search = ref('')
/** -1 = all groups, 0 = no group, otherwise the group id. */
const groupFilter = ref(-1)
/** -1 = all key educators, otherwise the employee id. */
const keyEducatorFilter = ref(-1)

const groupItems = computed(() => {
  const ids: (number | null)[] = []
  for (const child of active.value ?? []) if (!ids.includes(child.groupId)) ids.push(child.groupId)
  return [
    { label: de.children.allGroups, value: -1 },
    ...ids.map(id => ({ label: groupName(id), value: id ?? 0 })),
  ]
})
const keyEducatorItems = computed(() => [
  { label: de.children.allKeyEducators, value: -1 },
  ...staff.value.map(person => ({ label: person.name, value: person.id })),
])
// Offering the filter only makes sense when at least one child has a group.
const showGroups = computed(() => (active.value ?? []).some(child => child.groupId !== null))

const matches = (child: Pick<ChildListItemDto, 'firstName' | 'lastName'>, term: string) =>
  `${child.firstName} ${child.lastName}`.toLowerCase().includes(term) || `${child.lastName} ${child.firstName}`.toLowerCase().includes(term)

const blocks = computed(() => {
  const term = search.value.trim().toLowerCase()
  const result: { key: string; label: string | null; children: ChildListItemDto[] }[] = []
  for (const child of active.value ?? []) {
    if (groupFilter.value !== -1 && (child.groupId ?? 0) !== groupFilter.value) continue
    if (keyEducatorFilter.value !== -1 && child.keyEducatorId !== keyEducatorFilter.value) continue
    if (term && !matches(child, term)) continue
    const key = String(child.groupId)
    let block = result.find(entry => entry.key === key)
    if (!block) {
      block = { key, label: showGroups.value ? groupName(child.groupId) : null, children: [] }
      result.push(block)
    }
    block.children.push(child)
  }
  return result
})

const today = todayIso()
const limit = addDays(today, BIRTHDAY_WEEKS * 7)
const birthdays = computed(() => (birthdayList.value ?? []).filter(entry => entry.date <= limit))

const th = 'px-3 py-2'
const td = 'px-3 py-2'
</script>

<template>
  <div class="space-y-3" :class="tab === 'occupancy' || tab === 'staffing' || tab === 'attendance' || tab === 'overview' ? 'max-w-7xl' : 'max-w-5xl'">
    <div class="flex items-center gap-3">
      <h1 class="text-xl font-semibold">{{ de.children.title }}</h1>
      <!-- The planned tab has its own buttons for creating. -->
      <UButton v-if="canCreate && tab !== 'planned'" class="ml-auto min-h-11" size="md" icon="i-lucide-plus" :label="de.children.create" to="/children/new" />
    </div>

    <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorCode(error) === 'no_facility' ? de.errors.no_facility : errorMessage(error) }}</p>
    <template v-else>
      <!-- The areas as big buttons, the sub-tabs of the open one below them. -->
      <div role="tablist" :aria-label="de.children.areas.label" class="grid gap-2" :class="areas.length === 3 ? 'grid-cols-3' : 'grid-cols-2'">
        <button
          v-for="entry in areas" :id="`children-area-${entry.area}`" :key="entry.area" type="button" role="tab"
          :aria-selected="area === entry.area" :tabindex="area === entry.area ? 0 : -1" aria-controls="children-area-panel"
          class="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-base font-semibold ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="area === entry.area ? 'bg-sky-600 text-white ring-sky-600' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50'"
          @click="selectArea(entry.area)" @keydown="onTabKey($event, areaKeys, area, selectArea, 'children-area-')"
        >
          <UIcon :name="AREA_ICONS[entry.area]" class="size-5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ de.children.areas[entry.area] }}</span>
        </button>
      </div>

      <div id="children-area-panel" role="tabpanel" :aria-labelledby="`children-area-${area}`" class="space-y-3">
        <!-- The reminders belong to the day: on top of Heute only. -->
        <ChildrenRemindersBox v-if="area === 'today'" />
        <div v-if="areaTabs.length > 1" role="tablist" :aria-label="de.children.areas[area]" class="flex flex-wrap gap-1.5">
          <button
            v-for="key in areaTabs" :id="`children-tab-${key}`" :key="key" type="button" role="tab"
            :aria-selected="tab === key" :tabindex="tab === key ? 0 : -1" aria-controls="children-tab-panel"
            class="min-h-11 rounded-full px-4 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="tab === key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
            @click="selectTab(key)" @keydown="onTabKey($event, areaTabs, tab, selectTab, 'children-tab-')"
          >
            {{ TAB_LABELS[key] }}
          </button>
        </div>

        <div
          id="children-tab-panel" role="tabpanel" :aria-labelledby="areaTabs.length > 1 ? `children-tab-${tab}` : `children-area-${area}`"
          class="space-y-4"
        >
          <ChildrenAttendanceTab v-if="tab === 'attendance'" />
          <ChildrenWeekOverviewTab v-else-if="tab === 'week'" />

          <template v-else-if="tab === 'list'">
            <div class="flex flex-wrap items-center gap-3">
              <UInput v-model="search" :placeholder="de.children.search" :aria-label="de.children.search" icon="i-lucide-search" class="w-64" />
              <USelect v-if="showGroups" v-model="groupFilter" :items="groupItems" class="w-48" :aria-label="de.children.fields.group" />
              <USelect
                v-if="staff.length" v-model="keyEducatorFilter" :items="keyEducatorItems" class="w-56"
                :aria-label="de.children.fields.keyEducator"
              />
            </div>

            <p v-if="!blocks.length" class="text-sm text-gray-500">{{ de.children.empty }}</p>
            <div v-for="block in blocks" :key="block.key" class="space-y-1">
              <h2 v-if="block.label" class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ block.label }}</h2>
              <!-- On a phone the table scrolls sideways in its box, never the page. -->
              <div class="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
                <table class="w-full text-sm">
                  <thead class="bg-gray-100 text-left text-xs text-gray-600">
                    <tr>
                      <th :class="th">{{ de.children.fields.lastName }}, {{ de.children.fields.firstName }}</th>
                      <th :class="th">{{ de.children.ageAt }}</th>
                      <th :class="th">{{ de.children.fields.careType }}</th>
                      <th :class="th">{{ de.children.fields.keyEducator }}</th>
                      <th :class="th">{{ de.children.entry }}</th>
                      <th :class="th" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="child in block.children" :key="child.id" class="border-t border-gray-100">
                      <td :class="td"><NuxtLink :to="`/children/${child.id}`" class="font-medium text-sky-700 hover:underline">{{ child.lastName }}, {{ child.firstName }}</NuxtLink></td>
                      <td :class="td">{{ de.children.age(child.age.years, child.age.months) }}</td>
                      <td :class="td">{{ child.careTypeName ?? '–' }}</td>
                      <td :class="td">{{ child.keyEducatorName ?? '–' }}</td>
                      <td :class="td">{{ child.entryDate ? formatDate(child.entryDate) : '–' }}</td>
                      <td :class="[td, 'text-right']">
                        <span class="inline-flex items-center gap-2">
                          <UTooltip v-if="child.hasAllergies" :text="de.children.allergies">
                            <UIcon name="i-lucide-triangle-alert" class="size-5 text-amber-500" tabindex="0" :aria-label="de.children.allergies" />
                          </UTooltip>
                          <UTooltip v-if="child.contactBans.length">
                            <UIcon name="i-lucide-ban" class="size-5 text-red-600" tabindex="0" :aria-label="de.children.contactBan" />
                            <template #content>
                              <ul class="space-y-0.5 p-1 text-sm">
                                <li v-for="(ban, index) in child.contactBans" :key="index">{{ de.children.contactBan }}: {{ ban.name }} – {{ ban.note }}</li>
                              </ul>
                            </template>
                          </UTooltip>
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>

          <ChildrenOverviewTab v-else-if="tab === 'overview'" />
          <ChildrenPlannedTab v-else-if="tab === 'planned' && shown('planned')" />

          <template v-else-if="tab === 'birthdays'">
            <div class="flex flex-wrap items-center gap-3">
              <p class="text-sm text-gray-500">{{ de.children.birthdaysHint }}</p>
              <!-- No printouts at the tablet. -->
              <UButton v-if="!onTablet" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print" to="/print/children/birthdays" target="_blank" />
            </div>
            <p v-if="!birthdays.length" class="text-sm text-gray-500">{{ de.children.noBirthdays }}</p>
            <div v-else class="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
              <table class="w-full text-sm">
                <thead class="bg-gray-100 text-left text-xs text-gray-600">
                  <tr>
                    <th :class="th">{{ de.children.birthdayOn }}</th>
                    <th :class="th">{{ de.children.fields.name }}</th>
                    <th :class="th">{{ de.children.ageAt }}</th>
                    <th v-if="showGroups" :class="th">{{ de.children.fields.group }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="entry in birthdays" :key="entry.childId" class="border-t border-gray-100">
                    <td :class="td">{{ formatDate(entry.date) }}</td>
                    <td :class="td"><NuxtLink :to="`/children/${entry.childId}`" class="font-medium text-sky-700 hover:underline">{{ entry.name }}</NuxtLink></td>
                    <td :class="td">{{ de.children.turns(entry.turns) }}</td>
                    <td v-if="showGroups" :class="td">{{ groupName(entry.groupId) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <ChildrenDocumentOverviewTab v-else-if="tab === 'documents'" />
          <ChildrenOpenTab v-else-if="tab === 'open'" />
          <ChildrenOccupancyTab v-else-if="tab === 'occupancy' && shown('occupancy')" />
          <ChildrenStaffingTab v-else-if="tab === 'staffing' && shown('staffing')" />
          <ChildrenArchiveTab v-else-if="tab === 'archive' && shown('archive')" />
        </div>
      </div>
    </template>
  </div>
</template>
