<script setup lang="ts">
import { kitaYearLabel, kitaYearOf } from '#shared/domain/kitaYear'
import type { PlannedChildDto, PlannedChildrenDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ageAtStartText, telHref } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The waitlist (Vormerkungen) and the contract children who have not started yet, with filters for the group and the
 * Kita year of the (desired) start. Everybody who may read the child records sees it, the keepers of the records create.
 * At the tablet, people without manager rights see only the parts the facility's switches allow.
 */
const { rights, onTablet } = useChildRights()
const canCreate = computed(() => !!rights.value?.canEdit)
const showWaitlist = computed(() => !!rights.value?.showWaitlist)
const showContracted = computed(() => !!rights.value?.showFutureContracts)
const { groupName } = useChildLookups()

const { data, error } = useFetch<PlannedChildrenDto>('/api/children/planned', { key: 'children-planned' })

const search = ref('')
/** -1 = all groups, 0 = no group, otherwise the group id. */
const groupFilter = ref(-1)
/** -1 = all Kita years, otherwise the start year of the Kita year. */
const yearFilter = ref(-1)

const all = computed<PlannedChildDto[]>(() => [...(data.value?.waitlist ?? []), ...(data.value?.contracted ?? [])])
const groupItems = computed(() => {
  const ids: (number | null)[] = []
  for (const child of all.value) if (!ids.includes(child.groupId)) ids.push(child.groupId)
  return [
    { label: de.children.allGroups, value: -1 },
    ...ids.map(id => ({ label: groupName(id), value: id ?? 0 })),
  ]
})
const yearItems = computed(() => {
  const years = [...new Set(all.value.filter(child => child.plannedStart).map(child => kitaYearOf(child.plannedStart!)))].sort((a, b) => a - b)
  return [
    { label: de.children.admission.allKitaYears, value: -1 },
    ...years.map(year => ({ label: kitaYearLabel(year), value: year })),
  ]
})

const matches = (child: PlannedChildDto, term: string) =>
  `${child.firstName} ${child.lastName}`.toLowerCase().includes(term) || `${child.lastName} ${child.firstName}`.toLowerCase().includes(term)
function filtered(list: PlannedChildDto[] | undefined): PlannedChildDto[] {
  const term = search.value.trim().toLowerCase()
  return (list ?? []).filter(child =>
    (groupFilter.value === -1 || (child.groupId ?? 0) === groupFilter.value)
    && (yearFilter.value === -1 || (child.plannedStart !== null && kitaYearOf(child.plannedStart) === yearFilter.value))
    && (!term || matches(child, term)))
}
const waitlist = computed(() => filtered(data.value?.waitlist))
const contracted = computed(() => filtered(data.value?.contracted))

const a = de.children.admission
const th = 'px-3 py-2'
const td = 'px-3 py-2'
</script>

<template>
  <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
  <div v-else-if="data" class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <UInput v-model="search" :placeholder="de.children.search" :aria-label="de.children.search" icon="i-lucide-search" class="w-64" />
      <USelect v-model="groupFilter" :items="groupItems" class="w-48" :aria-label="de.children.fields.group" />
      <USelect v-model="yearFilter" :items="yearItems" class="w-44" :aria-label="a.kitaYear" />
      <span class="ml-auto flex flex-wrap items-center gap-2">
        <!-- No printouts at the tablet. -->
        <UButton v-if="!onTablet" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print" to="/print/children/planned" target="_blank" />
        <UButton v-if="canCreate && showWaitlist" color="neutral" variant="outline" icon="i-lucide-plus" :label="a.createWaitlist" to="/children/new?status=waitlist" />
        <UButton v-if="canCreate" icon="i-lucide-plus" :label="de.children.create" to="/children/new" />
      </span>
    </div>

    <section v-for="list in [
      ...(showWaitlist ? [{ key: 'waitlist', title: a.waitlistTitle, rows: waitlist, start: a.desiredStart, group: a.desiredGroup, waitlisted: true }] : []),
      ...(showContracted ? [{ key: 'contracted', title: a.contractedTitle, rows: contracted, start: a.contractStart, group: a.assignedGroup, waitlisted: false }] : []),
    ]" :key="list.key" class="space-y-1">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ list.title }} ({{ list.rows.length }})</h2>
      <p v-if="!list.rows.length" class="text-sm text-gray-500">{{ de.children.empty }}</p>
      <div v-else class="overflow-x-auto rounded-lg ring-1 ring-gray-200">
        <table class="w-full bg-white text-sm">
          <thead class="bg-gray-100 text-left text-xs text-gray-600">
            <tr>
              <th :class="th">{{ de.children.fields.lastName }}, {{ de.children.fields.firstName }}</th>
              <th :class="th">{{ de.children.fields.birthDate }}</th>
              <th :class="th">{{ a.ageAtStart }}</th>
              <th :class="th">{{ list.start }}</th>
              <th :class="th">{{ list.group }}</th>
              <th :class="th">{{ de.children.fields.careType }}</th>
              <th :class="th">{{ a.phone }}</th>
              <th :class="th">{{ de.children.fields.note }}</th>
              <th v-if="list.waitlisted" :class="th">{{ a.waitlistedOn }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="child in list.rows" :key="child.id" class="border-t border-gray-100">
              <td :class="td"><NuxtLink :to="`/children/${child.id}`" class="font-medium text-sky-700 hover:underline">{{ child.lastName }}, {{ child.firstName }}</NuxtLink></td>
              <td :class="[td, 'whitespace-nowrap']">{{ formatDate(child.birthDate) }}</td>
              <td :class="[td, 'whitespace-nowrap']">{{ ageAtStartText(child.birthDate, child.plannedStart) }}</td>
              <td :class="[td, 'whitespace-nowrap']">{{ child.plannedStart ? formatDate(child.plannedStart) : de.children.noValue }}</td>
              <td :class="td">{{ child.groupId === null ? de.children.noValue : groupName(child.groupId) }}</td>
              <td :class="td">{{ child.careTypeName ?? de.children.noValue }}</td>
              <td :class="[td, 'whitespace-nowrap']">
                <a v-if="child.phone && telHref(child.phone)" :href="telHref(child.phone)" class="text-sky-700 hover:underline">{{ child.phone }}</a>
                <template v-else>{{ child.phone || de.children.noValue }}</template>
              </td>
              <td :class="[td, 'max-w-48 whitespace-pre-line break-words']">{{ child.note || de.children.noValue }}</td>
              <td v-if="list.waitlisted" :class="[td, 'whitespace-nowrap']">{{ child.waitlistedOn ? formatDate(child.waitlistedOn) : de.children.noValue }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
