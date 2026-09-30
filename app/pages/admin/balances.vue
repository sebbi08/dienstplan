<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { formatSignedDuration } from '#shared/domain/time'
import type { BalanceDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatHours } from '~/utils/format'

const today = parseIsoDate(todayIso())
const year = ref(today.year)
const month = ref(today.month)
const { data } = await useFetch<BalanceDto[]>('/api/balances', { query: { year, month } })

function change(nextYear: number, nextMonth: number) {
  year.value = nextYear
  month.value = nextMonth
}
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-2xl font-semibold">{{ de.balances.title }}</span>
      <MonthNav :year="year" :month="month" @change="change" />
    </div>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.balances.name }}</th>
          <th class="px-3 py-2">{{ de.balances.weekly }}</th>
          <th class="px-3 py-2 text-right">{{ de.balances.today }}</th>
          <th class="px-3 py-2 text-right">{{ de.balances.monthEnd }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="balance in data ?? []" :key="balance.employeeId" class="border-t border-gray-100">
          <td class="px-3 py-2">{{ balance.name }}</td>
          <td class="px-3 py-2">{{ formatHours(balance.weeklyMinutes) }}</td>
          <td class="px-3 py-2 text-right font-medium" :class="balanceClass(balance.today)">{{ formatSignedDuration(balance.today) }}</td>
          <td class="px-3 py-2 text-right font-medium" :class="balanceClass(balance.monthEnd)">{{ formatSignedDuration(balance.monthEnd) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="text-xs text-gray-500">{{ de.balances.hint }}</p>
  </div>
</template>
