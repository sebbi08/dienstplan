<script setup lang="ts">
import { weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { EarlySickLeaveRowDto, EarlySickLeavesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'

/**
 * "Vorzeitig gegangen wegen Krankheit": the counts per employee and the year's days; shared by the sick-days page
 * (with a delete button per row) and its print view.
 */
defineProps<{ list: EarlySickLeavesDto; removable?: boolean }>()
const emit = defineEmits<{ remove: [row: EarlySickLeaveRowDto] }>()

const day = (date: string) => `${formatDayShort(date, weekday(date))}${date.slice(0, 4)}`
</script>

<template>
  <p v-if="!list.rows.length" class="px-2 py-1 text-sm text-gray-500">{{ de.sickLeave.empty }}</p>
  <div v-else class="space-y-3">
    <ul class="flex flex-wrap gap-x-4 gap-y-1 px-2 text-sm">
      <li v-for="total in list.totals" :key="total.employeeId">
        <span class="font-medium">{{ total.employeeName }}</span>: {{ de.sickLeave.count(total.count) }}
      </li>
    </ul>
    <table class="w-full border-collapse text-sm">
      <thead class="text-left text-xs text-gray-600">
        <tr>
          <th class="border border-gray-300 px-2 py-1">{{ de.sickLeave.date }}</th>
          <th class="border border-gray-300 px-2 py-1">{{ de.sickLeave.employee }}</th>
          <th class="border border-gray-300 px-2 py-1">{{ de.sickLeave.duty }}</th>
          <th class="border border-gray-300 px-2 py-1">{{ de.sickLeave.leftAt }}</th>
          <th class="border border-gray-300 px-2 py-1">{{ de.sickLeave.note }}</th>
          <th v-if="removable" class="border border-gray-300 px-2 py-1 print:hidden" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in list.rows" :key="row.id" class="break-inside-avoid align-top">
          <td class="whitespace-nowrap border border-gray-300 px-2 py-1">{{ day(row.date) }}</td>
          <td class="whitespace-nowrap border border-gray-300 px-2 py-1 font-medium">{{ row.employeeName }}</td>
          <td class="border border-gray-300 px-2 py-1">{{ row.duty }}</td>
          <td class="whitespace-nowrap border border-gray-300 px-2 py-1">
            <template v-if="row.leftAt !== null">
              {{ formatTime(row.leftAt) }}
              <span v-if="row.leftAtFromRecord" class="text-xs text-gray-500">({{ de.sickLeave.fromRecord }})</span>
            </template>
            <span v-else class="text-gray-500">{{ de.sickLeave.unknown }}</span>
          </td>
          <td class="border border-gray-300 px-2 py-1">{{ row.note }}</td>
          <td v-if="removable" class="border border-gray-300 px-1 py-0.5 text-right print:hidden">
            <UButton
              size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete"
              @click="emit('remove', row)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
