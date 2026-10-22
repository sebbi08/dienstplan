<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { StaffingMonthDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, monthTitle } from '~/utils/format'

/** The Personalschlüssel of a month for printing (Leitung and Träger): A4 landscape, the same table as the tab. */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 10mm; }' }] })

const route = useRoute()
const year = Number(route.params.year)
const month = Number(route.params.month)
const { data, error } = await useFetch<StaffingMonthDto>(`/api/staffing/${year}/${month}`, { key: 'print-children-staffing' })
</script>

<template>
  <div class="mx-auto max-w-6xl bg-white p-6 text-gray-900">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.staffing.printTitle(monthTitle(year, month)) }}</h1>
      <PrintActions :file-name="`Personalschluessel-${year}-${String(month).padStart(2, '0')}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <ChildrenStaffingReport v-else-if="data" :data="data" print />
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
