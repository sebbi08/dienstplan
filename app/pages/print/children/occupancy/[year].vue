<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { kitaYearLabel } from '#shared/domain/kitaYear'
import type { OccupancyDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, monthTitle } from '~/utils/format'
import { occupancyMonthShort, occupancyRowName } from '~/utils/occupancy'

definePageMeta({ layout: false })
// A wide table: stays A4 landscape (the shared print rule), over the full page width with readable text.
useHead({ style: [{ innerHTML: '@media print { html { font-size: 14px !important; } }' }] })

const year = Number(useRoute().params.year)
const { data, error } = await useFetch<OccupancyDto>('/api/children/occupancy', { query: { year }, key: 'print-children-occupancy' })

const th = 'px-1.5 py-1 text-center'
const td = 'px-1.5 py-1 text-center'
</script>

<template>
  <div class="mx-auto max-w-5xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.occupancy.printTitle(kitaYearLabel(year)) }}</h1>
      <PrintActions :file-name="`Belegung-${year}-${String((year + 1) % 100).padStart(2, '0')}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <p v-if="!data.rows.length" class="text-sm text-gray-600">{{ de.occupancy.empty }}</p>
      <table v-else class="w-full text-xs">
        <thead class="border-b border-gray-400 text-gray-600 print:font-bold print:text-gray-900">
          <tr>
            <th :class="[th, 'text-left']">{{ de.occupancy.group }}</th>
            <th :class="th">{{ de.occupancy.capacity }}</th>
            <th v-for="month in data.months" :key="`${month.year}-${month.month}`" :class="th" :title="monthTitle(month.year, month.month)">{{ occupancyMonthShort(month.month) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data.rows" :key="row.groupId ?? 'none'" class="border-b border-gray-200">
            <th scope="row" :class="[td, 'text-left font-medium']">{{ occupancyRowName(row) }}</th>
            <td :class="td">{{ row.capacity ?? de.children.noValue }}</td>
            <td v-for="(cell, index) in row.cells" :key="index" class="p-0.5"><ChildrenOccupancyCell :cell="cell" print /></td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t-2 border-gray-400 font-semibold">
            <th scope="row" :class="[td, 'text-left']">{{ de.occupancy.total }}</th>
            <td :class="td" :title="data.total.fromFacility ? de.occupancy.facilityCapacity : undefined">{{ data.total.capacity ?? de.children.noValue }}</td>
            <td v-for="(cell, index) in data.total.cells" :key="index" class="p-0.5"><ChildrenOccupancyCell :cell="cell" print /></td>
          </tr>
        </tfoot>
      </table>
      <p v-if="data.rows.length && data.total.fromFacility && data.total.capacity !== null" class="mt-3 text-xs text-gray-700">
        {{ de.occupancy.totalAgainstFacility(data.total.capacity) }}
      </p>
      <p v-if="data.undated.length" class="mt-3 text-xs text-gray-700">
        {{ de.occupancy.undated(data.undated.length) }} ({{ data.undated.map(child => child.name).join(', ') }})
      </p>
      <p v-if="data.inconsistent.length" class="mt-1 text-xs text-gray-700">
        {{ de.occupancy.inconsistent(data.inconsistent.length) }} ({{ data.inconsistent.map(child => child.name).join(', ') }})
      </p>
    </template>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
