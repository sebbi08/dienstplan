<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { LeaveForfeitListDto, LeaveForfeitRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatNumber } from '~/utils/format'

/**
 * „Hinweis auf Resturlaub ‹Jahr›“ („Urlaubsplanung“ and its print view): the facility's staff with leave of the year
 * left, and whether they read the notice. `print`: the print view (no button, no frame).
 */
const props = defineProps<{ year: number; print?: boolean }>()
const t = de.leaveForfeit
const { data, error } = await useFetch<LeaveForfeitListDto>('/api/leave-forfeit', { query: { year: computed(() => props.year) } })

function statusText(row: LeaveForfeitRowDto): string {
  if (row.status === 'read' && row.readAt) return t.statusRead(formatDate(todayIso(new Date(row.readAt))))
  return row.status === 'open' ? t.statusOpen : t.statusNoAccount
}
</script>

<template>
  <section :class="props.print ? 'space-y-2' : 'max-w-4xl space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200'">
    <div v-if="!props.print" class="flex flex-wrap items-center gap-3">
      <h2 class="font-semibold">{{ t.listTitle(props.year) }}</h2>
      <UButton
        class="ml-auto" size="xs" color="neutral" variant="outline" icon="i-lucide-printer" :label="t.print"
        :to="`/admin/print/leave-forfeit/${props.year}`" target="_blank"
      />
    </div>
    <p v-if="error" class="text-sm text-red-700">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <p class="text-xs text-gray-500">{{ t.window(formatDate(data.noticeFrom), formatDate(data.forfeitDate)) }}</p>
      <p v-if="!data.rows.length" class="text-sm text-gray-500">{{ t.none }}</p>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 text-left">
            <th class="py-1 pr-3 font-semibold">{{ t.name }}</th>
            <th class="py-1 pr-3 text-right font-semibold">{{ t.days }}</th>
            <th class="py-1 font-semibold">{{ t.status }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data.rows" :key="row.employeeId" class="border-b border-gray-100">
            <td class="py-1 pr-3">{{ row.name }}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{{ formatNumber(row.days) }}</td>
            <td class="py-1" :class="row.status === 'read' ? 'text-gray-700' : row.status === 'open' ? 'text-amber-700' : 'font-medium text-red-700'">
              {{ statusText(row) }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="text-xs text-gray-500">{{ t.daysHint }}</p>
    </template>
  </section>
</template>
