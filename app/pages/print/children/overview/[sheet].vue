<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ChildrenOverviewDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { overviewColumns, overviewSections } from '~/utils/childrenOverview'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * One tab of the children overview for printing (Leitung and Träger; the middleware keeps Mitarbeiter away and the
 * tablet never gets here): A4 landscape, head with facility, tab, group or „Alle Gruppen“ and date. The address names
 * the tab by its id; `?group=` as the group filter of the tab (0 = the children without group).
 */
definePageMeta({ layout: false, validate: route => typeof route.params.sheet === 'string' && /^\d+$/.test(route.params.sheet) })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 10mm; } @media print { html { font-size: 14px !important; } }' }] })

const route = useRoute()
const sheetId = Number(route.params.sheet)
const groupParam = typeof route.query.group === 'string' && /^\d+$/.test(route.query.group) ? Number(route.query.group) : null
const groupFilter = groupParam ?? -1

const { data, error } = await useFetch<ChildrenOverviewDto>('/api/children/overview', { key: 'print-children-overview' })
const { activeName } = useFacilities()

const t = de.children.overview
const sheet = computed(() => data.value?.sheets.find(entry => entry.id === sheetId) ?? null)
const sections = computed(() => (data.value ? overviewSections(data.value, groupFilter) : []))
const columns = computed(() => (data.value && sheet.value
  ? overviewColumns(sheet.value.columns, sections.value.flatMap(section => section.rows), { questions: data.value.questions, groups: data.value.groups })
  : []))
const showGroups = computed(() => (data.value?.children ?? []).some(child => child.groupId !== null))
const groupText = computed(() => {
  if (groupFilter === -1) return de.children.allGroups
  const group = data.value?.groups.find(entry => (entry.id ?? 0) === groupFilter)
  return groupFilter === 0 ? de.children.noGroup : group?.name ?? de.children.groupById(groupFilter)
})
const sheetName = computed(() => sheet.value?.name ?? '')
const fileName = computed(() => `Kinder-${sheetName.value}-${groupText.value}`)
</script>

<template>
  <div class="bg-white p-4 text-gray-900 print:p-0">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-xl font-semibold">{{ t.printTitle(activeName, sheetName, groupText) }}</h1>
      <span class="text-sm text-gray-700">{{ formatDate(todayIso()) }}</span>
      <PrintActions :file-name="fileName" :search="groupParam === null ? '' : `?group=${groupParam}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="data && !sheet" class="text-sm text-gray-600">{{ de.errors.overview_sheet_not_found }}</p>
    <p v-else-if="!sections.length" class="text-sm text-gray-600">{{ de.children.empty }}</p>
    <ChildrenOverviewTable v-else :columns="columns" :sections="sections" :show-groups="showGroups" print />
  </div>
</template>
