<script setup lang="ts">
import { addDays, todayIso } from '#shared/domain/dates'
import { isManager, mayEditChildren } from '#shared/domain/roles'
import type { BirthdayDto, ChildListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

const BIRTHDAY_WEEKS = 8
type Tab = 'list' | 'planned' | 'birthdays' | 'documents' | 'open' | 'occupancy' | 'archive'

const { user } = useUserSession()
const canCreate = computed(() => !!user.value && mayEditChildren(user.value))
const isLeader = computed(() => isManager(user.value?.role))
const lookups = useChildLookups()
const { groupName, staff } = lookups

const { data: active, error } = await useFetch<ChildListItemDto[]>('/api/children', { query: { status: 'active' }, key: 'children-active' })
const { data: birthdayList } = await useFetch<BirthdayDto[]>('/api/children/birthdays', { key: 'children-birthdays' })
await lookups.ready

const tab = ref<Tab>('list')
// The occupancy and the archive are for the managers only (the server answers 403 to everybody else).
const tabs = computed(() => [
  { key: 'list' as const, label: de.children.tabs.list },
  { key: 'planned' as const, label: de.children.tabs.planned },
  { key: 'birthdays' as const, label: de.children.tabs.birthdays },
  { key: 'documents' as const, label: de.children.tabs.documents },
  { key: 'open' as const, label: de.groupChange.openTab },
  ...(isLeader.value
    ? [{ key: 'occupancy' as const, label: de.occupancy.tab }, { key: 'archive' as const, label: de.children.tabs.archive }]
    : []),
])

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
  <div class="space-y-4" :class="tab === 'occupancy' ? 'max-w-7xl' : 'max-w-5xl'">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.children.title }}</h1>
      <UButton v-if="canCreate && tab !== 'planned'" class="ml-auto" icon="i-lucide-plus" :label="de.children.create" to="/children/new" />
    </div>

    <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorCode(error) === 'no_facility' ? de.errors.no_facility : errorMessage(error) }}</p>
    <template v-else>
      <div class="flex flex-wrap gap-1 border-b border-gray-200" role="tablist">
        <button
          v-for="entry in tabs" :key="entry.key" type="button" role="tab" :aria-selected="tab === entry.key"
          class="-mb-px border-b-2 px-3 py-2 text-sm"
          :class="tab === entry.key ? 'border-sky-600 font-medium text-sky-700' : 'border-transparent text-gray-600 hover:text-gray-900'"
          @click="tab = entry.key"
        >
          {{ entry.label }}
        </button>
      </div>

      <template v-if="tab === 'list'">
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
          <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
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
      </template>

      <ChildrenPlannedTab v-else-if="tab === 'planned'" />

      <template v-else-if="tab === 'birthdays'">
        <div class="flex flex-wrap items-center gap-3">
          <p class="text-sm text-gray-500">{{ de.children.birthdaysHint }}</p>
          <UButton class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print" to="/print/children/birthdays" target="_blank" />
        </div>
        <p v-if="!birthdays.length" class="text-sm text-gray-500">{{ de.children.noBirthdays }}</p>
        <table v-else class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
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
      </template>

      <ChildrenDocumentOverviewTab v-else-if="tab === 'documents'" />
      <ChildrenOpenTab v-else-if="tab === 'open'" />
      <ChildrenOccupancyTab v-else-if="tab === 'occupancy' && isLeader" />
      <ChildrenArchiveTab v-else-if="tab === 'archive' && isLeader" />
    </template>
  </div>
</template>
