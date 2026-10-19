<script setup lang="ts">
import type { ChildrenOverviewDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { OVERVIEW_SHEETS, type OverviewSheet, overviewColumns, overviewSections } from '~/utils/childrenOverview'
import { errorMessage } from '~/utils/errors'

/** The Excel-like tables of all children the person sees (the server sends only those), one sub-tab per sheet. */
const { data, error } = useFetch<ChildrenOverviewDto>('/api/children/overview', { key: 'children-overview' })
// Printing is for Leitung and Träger in the office; the tablet has no print buttons.
const { rights, onTablet } = useChildRights()
const canPrint = computed(() => !onTablet.value && !!rights.value?.isManager)

const t = de.children.overview
const sheet = ref<OverviewSheet>('privacy')
/** -1 = all groups, 0 = no group, otherwise the group id (as in the list). */
const groupFilter = ref(-1)

const groupItems = computed(() => [
  { label: de.children.allGroups, value: -1 },
  ...(data.value?.groups ?? []).map(group => ({ label: group.id === null ? de.children.noGroup : group.name, value: group.id ?? 0 })),
])
// Offering the filter and the group headings only makes sense when at least one child has a group.
const showGroups = computed(() => (data.value?.children ?? []).some(child => child.groupId !== null))
const sections = computed(() => (data.value ? overviewSections(data.value, groupFilter.value) : []))
const columns = computed(() => overviewColumns(sheet.value, sections.value.flatMap(section => section.rows)))
const printUrl = computed(() => `/print/children/overview/${sheet.value}${groupFilter.value === -1 ? '' : `?group=${groupFilter.value}`}`)
</script>

<template>
  <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
  <div v-else-if="data" class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex flex-wrap rounded-lg bg-white p-0.5 ring-1 ring-gray-200" role="group">
        <UButton
          v-for="entry in OVERVIEW_SHEETS" :key="entry" size="lg" :aria-pressed="sheet === entry"
          :variant="sheet === entry ? 'solid' : 'ghost'" :color="sheet === entry ? 'primary' : 'neutral'"
          :label="t.sheets[entry]" @click="sheet = entry"
        />
      </div>
      <USelect v-if="showGroups" v-model="groupFilter" size="lg" :items="groupItems" class="w-48" :aria-label="de.children.fields.group" />
      <UButton
        v-if="canPrint" class="ml-auto" size="lg" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print"
        :to="printUrl" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ t.hint }}</p>
    <p v-if="!sections.length" class="text-sm text-gray-500">{{ de.children.empty }}</p>
    <ChildrenOverviewTable v-else :columns="columns" :sections="sections" :show-groups="showGroups" />
  </div>
</template>
