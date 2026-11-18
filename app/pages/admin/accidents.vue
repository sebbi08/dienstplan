<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { AccidentListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

/**
 * Mehr → „Unfälle“ (Leitung/Träger, accidents.manage): every accident report of the active facility in the chosen year,
 * children's and employees', filtered by Kinder/Mitarbeiter/alle; each printable, the list too. Filling in and changing
 * happens in the child record and the Personalakte.
 */
type Filter = 'all' | 'child' | 'employee'
const o = de.accidents.overview
useHead({ title: o.title })
const route = useRoute()
const year = ref(Number(route.query.year) || parseIsoDate(todayIso()).year)
const filter = ref<Filter>('all')
const { data, error } = await useFetch<AccidentListItemDto[]>('/api/accidents', { query: { year }, default: () => [] })
const rows = computed(() => (data.value ?? []).filter(row => filter.value === 'all' || row.subject === filter.value))
const filterItems = (['all', 'child', 'employee'] as const).map(value => ({ label: o.filter[value], value }))
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ o.title }}</h1>
      <YearNav v-model="year" />
      <UButton
        class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="o.printList"
        :to="`/admin/print/accidents/${year}${filter === 'all' ? '' : `?filter=${filter}`}`" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ o.intro }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-gray-600">{{ o.filterLabel }}:</span>
      <UButton
        v-for="item in filterItems" :key="item.value" size="sm" :color="filter === item.value ? 'primary' : 'neutral'"
        :variant="filter === item.value ? 'solid' : 'outline'" :label="item.label" :aria-pressed="filter === item.value"
        @click="filter = item.value"
      />
      <span class="text-sm text-gray-500">{{ o.count(rows.length) }}</span>
    </div>
    <UAlert v-if="error" color="error" variant="soft" :title="errorMessage(error)" />
    <p v-else-if="!rows.length" class="text-sm text-gray-500">{{ o.none }}</p>
    <div v-else class="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
      <AccidentsOverviewTable :rows="rows" links />
    </div>
  </div>
</template>
