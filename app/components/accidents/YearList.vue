<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { AccidentListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

/**
 * The tabs „Unfälle“ (accidents.manage; formerly Mehr → „Unfälle“): the accident reports of one kind – the children's on
 * Kinder, the employees' on Mitarbeitende – of the active facility in the chosen year (`?year=` opens one), with the year's
 * printable list. The names lead to the child record or the Personalakte, where reports are filled in and changed.
 */
const props = defineProps<{ subject: 'child' | 'employee' }>()
const o = de.accidents.overview
const route = useRoute()
const yearOf = (query: unknown) => (typeof query === 'string' && /^\d{4}$/.test(query) ? Number(query) : null)
const year = ref(yearOf(route.query.year) ?? parseIsoDate(todayIso()).year)
// A link to the same tab with another year (e.g. a reminder clicked while the tab is open) switches to it.
watch(() => route.query.year, (query) => {
  const next = yearOf(query)
  if (next !== null) year.value = next
})
const { data, error, status } = useFetch<AccidentListItemDto[]>('/api/accidents', { query: { year }, default: () => [] })
const rows = computed(() => (data.value ?? []).filter(row => row.subject === props.subject))
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-3">
      <YearNav v-model="year" />
      <span class="text-sm text-gray-500">{{ o.count(rows.length) }}</span>
      <UButton
        class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="o.printList"
        :to="`/admin/print/accidents/${year}?filter=${subject}`" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ subject === 'child' ? o.introChild : o.introEmployee }}</p>
    <UAlert v-if="error" color="error" variant="soft" :title="errorMessage(error)" />
    <p v-else-if="status !== 'pending' && !rows.length" class="text-sm text-gray-500">{{ subject === 'child' ? o.noneChild : o.noneEmployee }}</p>
    <!-- `relative`: the hidden column title („Drucken“, sr-only) stays inside the scrolling box on a phone. -->
    <div v-else-if="rows.length" class="relative overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
      <AccidentsOverviewTable :rows="rows" links />
    </div>
  </div>
</template>
