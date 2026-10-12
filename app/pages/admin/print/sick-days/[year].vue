<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { EarlySickLeavesDto, SickYearRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: false })

const year = Number(useRoute().params.year)
const { data: rows, error } = await useFetch<SickYearRowDto[]>('/api/sick-days', { query: { year } })
const { data: earlyLeaves, error: earlyLeavesError } = await useFetch<EarlySickLeavesDto>('/api/early-sick-leaves', { query: { year } })

</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900">
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
