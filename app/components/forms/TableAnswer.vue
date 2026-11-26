<script setup lang="ts">
import { tableRowsOf, type TableAnswerRow, type TableColumn, type TableItem } from '#shared/domain/forms'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * A table's answer to read, as a real table (print, the comparison of two forms): the row labels of a fixed table in the
 * first column (a free table numbers its rows), ☒/☐ for ticks, dates as TT.MM.JJJJ, texts as plain text. Rows never
 * break across pages. A free table without rows shows `writeRows` empty rows to write in by hand (print), else
 * „keine Zeilen“.
 */
const props = defineProps<{ item: TableItem; value: unknown; writeRows?: number }>()
const t = de.forms.table

const rows = computed(() => tableRowsOf(props.item, props.value))
const blankRows = computed(() => (props.item.freeRows && !rows.value.length ? props.writeRows ?? 0 : 0))
const rowName = (index: number) => (props.item.freeRows ? String(index + 1) : props.item.rows[index]?.label ?? '')
function shown(row: TableAnswerRow, column: TableColumn): string {
  const cell = row.cells[column.id]
  if (column.type === 'checkbox') return cell === true ? '☒' : '☐'
  if (column.type === 'date') return typeof cell === 'string' && cell ? formatDate(cell) : ''
  return typeof cell === 'string' ? cell : ''
}
const cell = 'border border-gray-500 px-1.5 py-1 align-top'
</script>

<template>
  <p v-if="props.item.freeRows && !rows.length && !blankRows" class="text-sm text-gray-500">{{ de.formHistory.noRows }}</p>
  <div v-else class="max-w-full overflow-x-auto print:overflow-visible">
    <table class="w-full border-collapse">
      <thead>
        <tr class="bg-gray-100">
          <th :class="[cell, 'text-left', props.item.freeRows ? 'w-10' : 'w-[22%]']">{{ props.item.freeRows ? t.numberHeading : '' }}</th>
          <th v-for="column in props.item.columns" :key="column.id" :class="[cell, 'text-left font-semibold break-words', column.type === 'text' ? '' : 'w-[13%]']">
            {{ column.heading }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="row.id" class="break-inside-avoid">
          <th scope="row" :class="[cell, 'text-left font-medium break-words']">{{ rowName(index) }}</th>
          <td
            v-for="column in props.item.columns" :key="column.id"
            :class="[cell, 'break-words whitespace-pre-line', column.type === 'checkbox' ? 'text-center text-base print:text-[13px]' : '']"
          >
            {{ shown(row, column) }}
          </td>
        </tr>
        <tr v-for="line in blankRows" :key="`blank-${line}`" class="h-7 break-inside-avoid">
          <th scope="row" :class="[cell, 'text-left font-medium']">{{ line }}</th>
          <td v-for="column in props.item.columns" :key="column.id" :class="[cell, column.type === 'checkbox' ? 'text-center text-base print:text-[13px]' : '']">
            {{ column.type === 'checkbox' ? '☐' : '' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
