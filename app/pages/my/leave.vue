<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { LeaveAccountDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatNumber } from '~/utils/format'

const today = todayIso()
const year = ref(parseIsoDate(today).year)
const { data, error } = await useFetch<LeaveAccountDto>('/api/my/leave', { query: { year } })

const cards = computed(() => {
  const account = data.value?.account
  if (!account) return []
  return [
    { label: de.leave.entitlement, value: account.entitlement, highlight: false },
    { label: de.leave.carriedOver, value: account.carriedOver, highlight: false },
    { label: de.leave.taken, value: account.taken, highlight: false },
    { label: de.leave.planned, value: account.planned, highlight: false },
    { label: de.leave.available, value: account.available, highlight: true },
  ]
})
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leave.myTitle }}</h1>
      <YearNav v-model="year" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <template v-if="data">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div
          v-for="card in cards" :key="card.label" class="rounded-lg bg-white p-3"
          :class="card.highlight ? 'ring-2 ring-sky-500' : 'ring-1 ring-gray-200'"
        >
          <div class="text-xs text-gray-500">{{ card.label }}</div>
          <div class="text-2xl font-semibold">{{ formatNumber(card.value) }}</div>
        </div>
      </div>
      <section class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <h2 class="mb-2 font-semibold">{{ de.leave.ranges }}</h2>
        <p v-if="data.ranges.length === 0" class="text-sm text-gray-500">{{ de.leave.noRanges }}</p>
        <ul v-else class="divide-y divide-gray-100 text-sm">
          <li v-for="range in data.ranges" :key="range.from" class="flex justify-between py-1.5">
            <span>{{ range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}` }}</span>
            <span class="text-gray-500">{{ de.leave.days(range.days) }} · {{ range.to < today ? de.leave.rangeTaken : de.leave.rangePlanned }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
