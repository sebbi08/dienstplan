<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { SickYearRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: false })

const year = Number(useRoute().params.year)
const { data: rows, error } = await useFetch<SickYearRowDto[]>('/api/sick-days', { query: { year } })

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
    <p class="mt-1 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
