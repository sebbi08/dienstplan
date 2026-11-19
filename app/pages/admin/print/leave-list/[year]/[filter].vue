<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { decodeLeaveFilter } from '~/utils/leaveYearList'

definePageMeta({ layout: false })
// The requests have eight columns, too many for portrait: A4 landscape (the shared print rule) with a readable text.
useHead({ style: [{ innerHTML: '@page { size: A4 landscape !important; margin: 10mm !important; } @media print { html { font-size: 12px !important; } table td, table th { padding-top: 2px !important; padding-bottom: 2px !important; } }' }] })

/** „Alle Anträge und Urlaube“ printed with the page's filters (in the path: ‹Mitarbeiter›-‹Art›-‹Status›, „alle“ for none). */
const route = useRoute()
const year = Number(route.params.year)
const filter = ref(decodeLeaveFilter(String(route.params.filter ?? '')))
</script>

<template>
  <div class="mx-auto max-w-6xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leaveYearList.title(year) }}</h1>
      <PrintActions :file-name="`Antraege-und-Urlaube-${year}`" />
    </div>
    <LeaveYearList v-model:filter="filter" :year="year" print />
    <p class="mt-2 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
