<script setup lang="ts">
import { formatCents } from '#shared/domain/cash'
import { todayIso } from '#shared/domain/dates'
import type { CashMonthDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime, monthTitle } from '~/utils/format'

/**
 * One month's sheet of a box for printing, laid out like the template „Kassenblatt“: header with the balances, then
 * one line per entry with the columns Einnahmen (Nr., Datum, Betrag) | Ausgaben (Nr., Datum, Betrag) | Verwendungszweck.
 */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; this sheet is portrait like the template, so its rule must win.
useHead({ title: de.cash.sheet, style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })

const route = useRoute()
const boxId = Number(route.params.id)
const year = Number(route.params.year)
const month = Number(route.params.month)
const { user } = useUserSession()
const { data, error } = await useFetch<CashMonthDto>(`/api/cash/boxes/${boxId}/${year}/${month}`)
const title = monthTitle(year, month)
const fileName = computed(() => `Kassenbuch-${data.value?.box.name ?? boxId}-${year}-${String(month).padStart(2, '0')}`)

const cell = 'border border-gray-500 px-1.5 py-1'
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0 print:text-[12px]">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-bold print:text-[20px]">{{ de.cash.sheet }}</h1>
      <PrintActions :file-name="fileName" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="data">
      <div class="mb-4 grid grid-cols-2 gap-x-8 text-sm print:text-[12px]">
        <div class="space-y-1">
          <div class="font-semibold">{{ de.cash.boxLabel(data.box.name) }}</div>
          <div>{{ de.cash.monthYear(title) }}</div>
          <div class="text-gray-600">{{ data.box.groupName ?? de.cash.facility }} · {{ de.cash.kinds[data.box.kind] }}</div>
        </div>
        <table class="w-full border-collapse">
          <tbody>
            <tr><td :class="cell">{{ de.cash.opening }}</td><td :class="[cell, 'text-right tabular-nums']">{{ formatCents(data.opening) }}</td></tr>
            <tr><td :class="cell">{{ de.cash.income }}</td><td :class="[cell, 'text-right tabular-nums']">{{ formatCents(data.income) }}</td></tr>
            <tr><td :class="cell">{{ de.cash.expense }}</td><td :class="[cell, 'text-right tabular-nums']">{{ formatCents(data.expense) }}</td></tr>
            <tr class="font-semibold"><td :class="cell">{{ de.cash.closing }}</td><td :class="[cell, 'text-right tabular-nums']">{{ formatCents(data.closing) }}</td></tr>
          </tbody>
        </table>
      </div>
      <p v-if="data.negative" class="mb-2 text-sm font-semibold">{{ de.cash.negative }}</p>

      <table class="w-full border-collapse text-xs print:text-[11px]">
        <thead>
          <tr class="bg-gray-100">
            <th :class="cell" colspan="3">{{ de.cash.income }}</th>
            <th :class="cell" colspan="3">{{ de.cash.expense }}</th>
            <th :class="[cell, 'text-left']" rowspan="2">{{ de.cash.purpose }}</th>
          </tr>
          <tr class="bg-gray-100">
            <th :class="cell">{{ de.cash.number }}</th><th :class="cell">{{ de.cash.date }}</th><th :class="[cell, 'text-right']">{{ de.cash.amount }}</th>
            <th :class="cell">{{ de.cash.number }}</th><th :class="cell">{{ de.cash.date }}</th><th :class="[cell, 'text-right']">{{ de.cash.amount }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data.rows" :key="row.id" class="break-inside-avoid align-top">
            <template v-if="row.direction === 'in'">
              <td :class="[cell, 'text-center']">{{ row.number }}</td>
              <td :class="[cell, 'whitespace-nowrap']">{{ formatDate(row.date) }}</td>
              <td :class="[cell, 'whitespace-nowrap text-right tabular-nums']">{{ formatCents(row.cents) }}</td>
              <td :class="cell" /><td :class="cell" /><td :class="cell" />
            </template>
            <template v-else>
              <td :class="cell" /><td :class="cell" /><td :class="cell" />
              <td :class="[cell, 'text-center']">{{ row.number }}</td>
              <td :class="[cell, 'whitespace-nowrap']">{{ formatDate(row.date) }}</td>
              <td :class="[cell, 'whitespace-nowrap text-right tabular-nums']">{{ formatCents(row.cents) }}</td>
            </template>
            <td :class="[cell, 'break-words']">{{ row.purpose }}</td>
          </tr>
          <tr v-if="!data.rows.length"><td :class="[cell, 'text-center text-gray-500']" colspan="7">{{ de.cash.noEntries }}</td></tr>
        </tbody>
        <tfoot>
          <tr class="font-semibold">
            <td :class="cell" colspan="2">{{ de.cash.total }}</td>
            <td :class="[cell, 'whitespace-nowrap text-right tabular-nums']">{{ formatCents(data.income) }}</td>
            <td :class="cell" colspan="2">{{ de.cash.total }}</td>
            <td :class="[cell, 'whitespace-nowrap text-right tabular-nums']">{{ formatCents(data.expense) }}</td>
            <td :class="cell" />
          </tr>
        </tfoot>
      </table>

      <div class="mt-6 space-y-1 text-xs text-gray-600 break-inside-avoid print:text-[10px]">
        <p>{{ de.cash.printedBy(formatDate(todayIso()), user?.username ?? '') }}</p>
        <p>{{ data.closed ? de.cash.closedBy(formatDateTime(data.closed.at), data.closed.by) : de.cash.notClosed }}</p>
      </div>
    </template>
  </div>
</template>
