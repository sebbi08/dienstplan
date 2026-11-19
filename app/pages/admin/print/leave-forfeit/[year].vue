<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: false })
// A short list: A4 portrait over the full page width, readable text (the shared print rule is landscape with 10px).
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 13.5px !important; } table td, table th { padding-top: 2px !important; padding-bottom: 2px !important; } }' }] })

const year = Number(useRoute().params.year)
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leaveForfeit.listTitle(year) }}</h1>
      <PrintActions :file-name="`Hinweis-Resturlaub-${year}`" />
    </div>
    <LeaveForfeitList :year="year" print />
    <p class="mt-1 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
