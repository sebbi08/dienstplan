<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { AccidentListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * The table of the overview „Unfälle“ (page and printout): Datum, Person (Kind/Mitarbeiter and name), Vorlage, Arztbesuch
 * / arbeitsunfähig, gemeldet am; with `links` each report has its printout (child reports under /print/children).
 */
defineProps<{ rows: AccidentListItemDto[]; links?: boolean }>()
const o = de.accidents.overview
const a = de.accidents
const printUrl = (row: AccidentListItemDto) => (row.subject === 'child' ? `/print/children/accidents/${row.id}` : `/print/accidents/${row.id}`)
const flags = (row: AccidentListItemDto) => [row.doctor ? a.doctorBadge : '', row.unfit ? a.unfitBadge : ''].filter(Boolean).join(' / ') || '–'
const cell = 'border-b border-gray-200 px-2 py-1.5 align-top print:border-gray-400 print:px-1 print:py-0.5'
</script>

<template>
  <table class="w-full text-sm">
    <thead>
      <tr class="text-left text-gray-600">
        <th :class="cell">{{ o.date }}</th>
        <th :class="cell">{{ o.person }}</th>
        <th :class="cell">{{ o.template }}</th>
        <th :class="cell">{{ o.doctorUnfit }}</th>
        <th :class="cell">{{ o.reportedOn }}</th>
        <th v-if="links" :class="[cell, 'print:hidden']"><span class="sr-only">{{ a.print }}</span></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.id">
        <td :class="[cell, 'whitespace-nowrap']">
          {{ row.date ? formatDate(row.date) : '' }}<span v-if="row.start !== null" class="text-gray-500"> {{ formatTime(row.start) }}</span>
        </td>
        <td :class="cell">
          <span class="mr-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 print:bg-transparent print:p-0">{{ o.subjects[row.subject] }}</span>
          <NuxtLink v-if="links && row.subject === 'child' && row.childId !== null" :to="`/children/${row.childId}`" class="font-medium text-sky-700 hover:underline print:text-gray-900">{{ row.personName }}</NuxtLink>
          <NuxtLink v-else-if="links && row.employeeId !== null" :to="`/admin/employees/${row.employeeId}?tab=accidents`" class="font-medium text-sky-700 hover:underline print:text-gray-900">{{ row.personName }}</NuxtLink>
          <span v-else class="font-medium">{{ row.personName }}</span>
        </td>
        <td :class="[cell, 'break-words']">{{ row.title }}</td>
        <td :class="cell">{{ flags(row) }}</td>
        <td :class="cell">
          <span v-if="row.reportedOn">{{ formatDate(row.reportedOn) }}</span>
          <span v-else-if="row.doctor || row.unfit" class="text-red-700">{{ a.notReported }}</span>
          <span v-else class="text-gray-400">–</span>
        </td>
        <td v-if="links" :class="[cell, 'print:hidden']">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-printer" :to="printUrl(row)" target="_blank" :aria-label="`${a.print}: ${row.personName}, ${row.title}`" />
        </td>
      </tr>
    </tbody>
  </table>
</template>
