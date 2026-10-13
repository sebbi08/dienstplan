<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { EarlySickLeaveRowDto, EarlySickLeavesDto, SickYearRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

const route = useRoute()
const year = ref(Number(route.query.year) || parseIsoDate(todayIso()).year)
const { data: rows } = await useFetch<SickYearRowDto[]>('/api/sick-days', { query: { year } })
const { data: earlyLeaves, refresh: refreshEarlyLeaves } = await useFetch<EarlySickLeavesDto>('/api/early-sick-leaves', { query: { year } })
const run = useAction(refreshEarlyLeaves)
const confirm = useConfirm()

async function removeEarlyLeave(row: EarlySickLeaveRowDto) {
  if (!await confirm(de.sickLeave.deleteConfirm(row.employeeName, formatDate(row.date)))) return
  run(() => $fetch<unknown>(`/api/early-sick-leaves/${row.id}`, { method: 'DELETE' }), de.common.deleted)
}
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

    <section class="space-y-2 rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <h2 class="text-lg font-semibold">{{ de.sickLeave.listTitle }}</h2>
      <p class="text-sm text-gray-500">{{ de.sickLeave.listHint }}</p>
      <SickLeaveList :list="earlyLeaves ?? { rows: [], totals: [] }" removable @remove="removeEarlyLeave" />
    </section>
  </div>
</template>
