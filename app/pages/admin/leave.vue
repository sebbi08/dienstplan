<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { LeaveAccountDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatNumber } from '~/utils/format'

const year = ref(parseIsoDate(todayIso()).year)
const { data } = await useFetch<LeaveAccountDto[]>('/api/leave', { query: { year } })
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leave.title }}</h1>
      <YearNav v-model="year" />
    </div>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.leave.name }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.entitlement }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.carriedOver }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.taken }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.planned }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.available }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data ?? []" :key="row.employeeId" class="border-t border-gray-100">
          <td class="px-3 py-2">
            <NuxtLink :to="`/admin/employees/${row.employeeId}`" class="text-sky-700 hover:underline">{{ row.name }}</NuxtLink>
          </td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.entitlement) }}</td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.carriedOver) }}</td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.taken) }}</td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.planned) }}</td>
          <td class="px-3 py-2 text-right font-semibold" :class="row.account.available < 0 ? 'text-red-700' : ''">{{ formatNumber(row.account.available) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
