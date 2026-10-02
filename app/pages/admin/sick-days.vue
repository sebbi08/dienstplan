<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { SickYearRowDto } from '#shared/types/api'
import { de } from '~/locales/de'

const route = useRoute()
const year = ref(Number(route.query.year) || parseIsoDate(todayIso()).year)
const { data: rows } = await useFetch<SickYearRowDto[]>('/api/sick-days', { query: { year } })
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.sickDays.title }}</h1>
      <YearNav v-model="year" />
      <UButton
        class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print"
        :to="`/admin/print/sick-days/${year}`" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ de.year.adminOnly }} {{ de.sickDays.hint }}</p>
    <div class="rounded-lg bg-white ring-1 ring-gray-200">
      <CalendarSickYearTable :rows="rows ?? []" />
    </div>
  </div>
</template>
