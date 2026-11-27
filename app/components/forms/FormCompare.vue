<script setup lang="ts">
import { itemLabel, type CompareRow, type CompareSection, type Trend } from '#shared/domain/formHistory'
import { de } from '~/locales/de'

/**
 * Two forms side by side (compareForms): per section and item the older answer left, the newer right, ratings and
 * milestones with a trend arrow (↑ better, ↓ weaker, = the same). Under a table in both forms what changed cell by cell
 * (rows added and removed) when both copies are built alike, else „Tabelle geändert“ (row.table, each table read through
 * its own form's copy). On phones each item stacks both answers with their labels; the printout has the three columns,
 * except that a table gets the full width (older above newer), so its columns are not squeezed.
 */
const props = defineProps<{ sections: CompareSection[]; olderLabel: string; newerLabel: string }>()
const h = de.formHistory

// A choices item without a question is named by its section (the options are listed in the answers).
const rowLabel = (row: CompareRow, section: CompareSection) => itemLabel((row.newerItem ?? row.olderItem)!, section.title)
const isTable = (row: CompareRow) => row.newerItem?.kind === 'table' || row.olderItem?.kind === 'table'
const arrow: Record<Trend, string> = { up: '↑', down: '↓', same: '=' }
const arrowClass: Record<Trend, string> = { up: 'text-green-700', down: 'text-red-700', same: 'text-gray-500' }
const columns = 'sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] print:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]'
</script>

<template>
  <div class="space-y-4 print:space-y-3">
    <section
      v-for="section in props.sections" :key="section.id"
      class="min-w-0 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4 print:rounded-none print:p-0 print:ring-0"
    >
      <h3 class="mb-2 font-semibold break-words print:border-b print:border-gray-400 print:text-[13px]">{{ section.title }}</h3>
      <div class="hidden gap-3 border-b border-gray-200 pb-1 text-xs font-semibold text-gray-600 sm:grid print:grid" :class="columns">
        <span />
        <span>{{ props.olderLabel }}</span>
        <span>{{ props.newerLabel }}</span>
      </div>
      <div
        v-for="(row, index) in section.rows" :key="`${section.id}-${index}`"
        class="grid gap-1 border-b border-gray-100 py-2 last:border-b-0 sm:gap-3 print:gap-3" :class="[columns, isTable(row) ? '' : 'print:break-inside-avoid']"
      >
        <p class="text-sm font-medium break-words" :class="isTable(row) ? 'print:col-span-3' : ''">{{ rowLabel(row, section) }}</p>
        <div class="min-w-0" :class="isTable(row) ? 'print:col-span-3' : ''">
          <p class="text-xs text-gray-500 sm:hidden" :class="isTable(row) ? 'print:block' : 'print:hidden'">{{ props.olderLabel }}</p>
          <FormsAnswerValue :item="row.olderItem" :value="row.older" />
        </div>
        <div class="flex min-w-0 items-start gap-2" :class="isTable(row) ? 'print:col-span-3' : ''">
          <div class="min-w-0 flex-1">
            <p class="text-xs text-gray-500 sm:hidden" :class="isTable(row) ? 'print:block' : 'print:hidden'">{{ props.newerLabel }}</p>
            <FormsAnswerValue :item="row.newerItem" :value="row.newer" />
          </div>
          <span
            v-if="row.trend" class="text-lg leading-none font-bold" :class="arrowClass[row.trend]" :title="h.trend[row.trend]"
            role="img" :aria-label="h.trend[row.trend]"
          >{{ arrow[row.trend] }}</span>
        </div>
        <div v-if="row.table?.kind === 'diff'" class="min-w-0 sm:col-span-3 print:col-span-3">
          <FormsItemHistory :item="row.newerItem!" :diff="row.table.diff" />
        </div>
        <p
          v-else-if="row.table?.kind === 'structure'"
          class="rounded-md bg-amber-50/60 p-2 text-sm ring-1 ring-amber-200 sm:col-span-3 print:col-span-3"
        >
          <span class="mr-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{{ h.tableChanged }}</span>
          {{ h.tableChangedHint }}
        </p>
      </div>
    </section>
  </div>
</template>
