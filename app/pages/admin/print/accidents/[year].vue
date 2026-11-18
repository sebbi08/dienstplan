<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { AccidentListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/** The list „Unfälle“ of a year printed (A4 portrait), with the page's filter (`?filter=child|employee`). */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })

const o = de.accidents.overview
const route = useRoute()
const year = Number(route.params.year)
const filter = route.query.filter === 'child' || route.query.filter === 'employee' ? route.query.filter : 'all'
const { data, error } = await useFetch<AccidentListItemDto[]>('/api/accidents', { query: { year }, default: () => [] })
const rows = computed(() => (data.value ?? []).filter(row => filter === 'all' || row.subject === filter))
useHead({ title: o.printTitle(year) })
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ o.printTitle(year) }}</h1>
      <span class="text-sm text-gray-600">{{ o.filterLabel }}: {{ o.filter[filter] }}</span>
      <PrintActions :file-name="`Unfaelle-${year}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!rows.length" class="text-sm text-gray-500">{{ o.none }}</p>
    <AccidentsOverviewTable v-else :rows="rows" />
    <p class="mt-3 text-xs text-gray-500">{{ o.count(rows.length) }} · {{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
