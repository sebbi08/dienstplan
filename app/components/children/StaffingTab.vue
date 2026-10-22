<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { StaffingMonthDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { monthTitle, shiftMonth } from '~/utils/format'

/**
 * Leitung and Träger in the office (never the tablet): the Personalschlüssel of a month, required against planned staff
 * per group and for the facility, with a printout.
 */
const today = parseIsoDate(todayIso())
const month = ref({ year: today.year, month: today.month })
const url = computed(() => `/api/staffing/${month.value.year}/${month.value.month}`)
const { data, error } = useFetch<StaffingMonthDto>(url, { key: 'children-staffing' })

const go = (delta: number) => (month.value = shiftMonth(month.value.year, month.value.month, delta))
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-1">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" :aria-label="de.common.previousMonth" @click="go(-1)" />
        <span class="min-w-40 text-center text-xl font-semibold">{{ monthTitle(month.year, month.month) }}</span>
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" :aria-label="de.common.nextMonth" @click="go(1)" />
      </div>
      <UButton
        class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.staffing.print"
        :to="`/print/children/staffing/${month.year}/${month.month}`" target="_blank"
      />
    </div>
    <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <ChildrenStaffingReport v-else-if="data" :data="data" />
  </div>
</template>
