<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { IfsgCaseDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/** The list „§ 34 IfSG“ of a year printed (A4 landscape), all cases or only the open ones (`?filter=open`). */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape !important; margin: 12mm !important; }' }] })

const s = de.ifsg
const o = s.overview
const route = useRoute()
const year = Number(route.params.year)
const onlyOpen = route.query.filter === 'open'
const { data, error } = await useFetch<IfsgCaseDto[]>('/api/ifsg/cases', { query: { year }, key: 'print-ifsg-cases', default: () => [] })
const rows = computed(() => (data.value ?? []).filter(row => !onlyOpen || row.open).reverse())
useHead({ title: o.printTitle(year) })

const readmitted = (row: IfsgCaseDto) => (row.readmittedOn ? formatDate(row.readmittedOn) : row.ended ? o.ended : o.open)
const th = 'px-2 py-1.5'
const td = 'px-2 py-1.5 align-top'
</script>

<template>
  <div class="mx-auto max-w-5xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ o.printTitle(year) }}</h1>
      <span v-if="onlyOpen" class="text-sm text-gray-600">{{ o.filter.open }}</span>
      <PrintActions :file-name="`IfSG-${year}`" :search="onlyOpen ? '?filter=open' : ''" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!rows.length" class="text-sm text-gray-500">{{ o.none }}</p>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-gray-400 text-left text-xs text-gray-600 print:text-gray-900">
        <tr>
          <th :class="th">{{ o.columns.reported }}</th>
          <th :class="th">{{ o.columns.child }}</th>
          <th :class="th">{{ o.columns.group }}</th>
          <th :class="th">{{ o.columns.disease }}</th>
          <th :class="th">{{ o.columns.kind }}</th>
          <th :class="th">{{ o.columns.notified }}</th>
          <th :class="th">{{ o.columns.readmitted }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" class="break-inside-avoid border-b border-gray-200">
          <td :class="td" class="whitespace-nowrap">{{ formatDate(row.reportedOn) }}</td>
          <td :class="td">{{ row.childName }}</td>
          <td :class="td">{{ row.groupName }}</td>
          <td :class="td">{{ row.diseaseName }}</td>
          <td :class="td">{{ s.kinds[row.kind] }}</td>
          <td :class="td">
            <template v-if="row.healthOfficeNotifiedOn">{{ formatDate(row.healthOfficeNotifiedOn) }}</template>
            <template v-if="row.physicianReported"><template v-if="row.healthOfficeNotifiedOn"> · </template>{{ o.physicianReported }}</template>
            <template v-if="!row.healthOfficeNotifiedOn && !row.physicianReported">–</template>
          </td>
          <td :class="td">{{ readmitted(row) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="mt-3 text-xs text-gray-500">{{ o.count(rows.length) }} · {{ de.time.printedAt(formatDate(todayIso())) }}</p>
    <p class="mt-1 text-xs text-gray-500">{{ s.footer }}</p>
  </div>
</template>
