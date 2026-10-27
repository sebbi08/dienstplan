<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ChildrenOverviewDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { isOverviewSheet, type OverviewSheet, overviewColumns, overviewSections } from '~/utils/childrenOverview'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * One sheet of the children overview for printing (Leitung and Träger; the middleware keeps Mitarbeiter away and the
 * tablet never gets here): A4 landscape, head with facility, sheet, group or „Alle Gruppen“ and date.
 * `?group=` as the group filter of the tab (0 = the children without group).
 */
definePageMeta({ layout: false, validate: route => isOverviewSheet(route.params.sheet) })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 10mm; } @media print { html { font-size: 14px !important; } }' }] })

const route = useRoute()
const sheet = route.params.sheet as OverviewSheet
const groupParam = typeof route.query.group === 'string' && /^\d+$/.test(route.query.group) ? Number(route.query.group) : null
const groupFilter = groupParam ?? -1

const { data, error } = await useFetch<ChildrenOverviewDto>('/api/children/overview', { key: 'print-children-overview' })
const { activeName } = useFacilities()

const t = de.children.overview
const sections = computed(() => (data.value ? overviewSections(data.value, groupFilter) : []))
const columns = computed(() => overviewColumns(sheet, sections.value.flatMap(section => section.rows)))
const showGroups = computed(() => (data.value?.children ?? []).some(child => child.groupId !== null))
const groupText = computed(() => {
  if (groupFilter === -1) return de.children.allGroups
  const group = data.value?.groups.find(entry => (entry.id ?? 0) === groupFilter)
  return groupFilter === 0 ? de.children.noGroup : group?.name ?? de.children.groupById(groupFilter)
})
const fileName = computed(() => `Kinder-${t.sheets[sheet]}-${groupText.value}`)
</script>

<template>
  <div class="bg-white p-4 text-gray-900 print:p-0">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-xl font-semibold">{{ t.printTitle(activeName, t.sheets[sheet], groupText) }}</h1>
      <span class="text-sm text-gray-700">{{ formatDate(todayIso()) }}</span>
      <PrintActions :file-name="fileName" :search="groupParam === null ? '' : `?group=${groupParam}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!sections.length" class="text-sm text-gray-600">{{ de.children.empty }}</p>
    <ChildrenOverviewTable v-else :columns="columns" :sections="sections" :show-groups="showGroups" print />
  </div>
</template>
