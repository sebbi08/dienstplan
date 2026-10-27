<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { EarlySickLeavesDto, SickYearRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: false })
// A short list: A4 portrait over the full page width, readable text (the shared print rule is landscape with 10px).
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 13.5px !important; } table td, table th { padding-top: 2px !important; padding-bottom: 2px !important; } }' }] })

const year = Number(useRoute().params.year)
const { data: rows, error } = await useFetch<SickYearRowDto[]>('/api/sick-days', { query: { year } })
const { data: earlyLeaves, error: earlyLeavesError } = await useFetch<EarlySickLeavesDto>('/api/early-sick-leaves', { query: { year } })

</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.sickDays.printTitle(year) }}</h1>
      <PrintActions :file-name="`Krankheitstage-${year}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <CalendarSickYearTable v-else :rows="rows ?? []" />
    <p class="mt-3 text-xs text-gray-500">{{ de.sickDays.hint }}</p>

    <h2 class="mb-2 mt-6 text-lg font-semibold">{{ de.sickLeave.listTitle }}</h2>
    <p v-if="earlyLeavesError" class="text-red-700">{{ errorMessage(earlyLeavesError) }}</p>
    <SickLeaveList v-else :list="earlyLeaves ?? { rows: [], totals: [] }" />
    <p class="mt-3 text-xs text-gray-500">{{ de.sickLeave.printHint }}</p>
    <p class="mt-1 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
