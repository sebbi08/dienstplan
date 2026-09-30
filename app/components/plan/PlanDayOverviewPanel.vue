<script setup lang="ts">
import { buildDayOverview, type SlotState } from '#shared/domain/dayOverview'
import { formatTime } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { slotClasses } from '~/utils/colors'
import { formatDate } from '~/utils/format'

const props = defineProps<{ plan: MonthPlanDto; date: string }>()
const emit = defineEmits<{ close: [] }>()

const LEGEND: SlotState[] = ['work', 'support', 'break', 'absent', 'prep_time', 'office', 'holiday', 'other']
const names = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))
const day = computed(() => props.plan.days.find(candidate => candidate.date === props.date))
const overview = computed(() => buildDayOverview(
  props.plan.employees.map(employee => ({
    employeeId: employee.id,
    entries: props.plan.entries.filter(entry => entry.employeeId === employee.id && entry.date === props.date),
  })),
  Boolean(day.value?.holidayKey),
))
const gridStyle = computed(() => ({
  gridTemplateColumns: `9rem repeat(${overview.value.slotStarts.length}, minmax(0.9rem, 1fr))`,
}))
</script>

<template>
  <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
    <div class="mb-2 flex items-center">
      <h2 class="font-semibold">{{ de.overview.title(formatDate(date)) }}</h2>
      <UButton class="ml-auto" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="de.common.close" @click="emit('close')" />
    </div>
    <div class="overflow-x-auto">
      <div class="grid gap-px text-xs" :style="gridStyle">
        <div />
        <div v-for="start in overview.slotStarts" :key="start" class="whitespace-nowrap text-[10px] text-gray-500">
          {{ start % 60 === 0 ? formatTime(start) : '' }}
        </div>
        <template v-for="row in overview.rows" :key="row.employeeId">
          <div class="truncate pr-2">{{ names.get(row.employeeId) }}</div>
          <div
            v-for="(state, index) in row.states" :key="index" class="h-5"
            :class="slotClasses[state]" :title="`${formatTime(overview.slotStarts[index]!)} · ${de.overview.legend[state]}`"
          />
        </template>
        <div class="pr-2 font-semibold">{{ de.overview.present }}</div>
        <div v-for="(count, index) in overview.present" :key="`present-${index}`" class="text-center font-semibold">{{ count }}</div>
      </div>
    </div>
    <div class="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
      <span v-for="state in LEGEND" :key="state" class="flex items-center gap-1">
        <span class="inline-block h-3 w-3 rounded-sm" :class="slotClasses[state]" />
        {{ de.overview.legend[state] }}
      </span>
    </div>
  </section>
</template>
