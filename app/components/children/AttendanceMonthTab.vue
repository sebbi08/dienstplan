<script setup lang="ts">
import { parseIsoDate, todayIso, weekday } from '#shared/domain/dates'
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceMonthChildDto, AttendanceMonthDto, AttendanceMonthRemarkInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { MONTH_CELL_SYMBOL } from '~/utils/attendance'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The month table of the child attendance (spec §4): per group a row per child and a column per day (✓ K U E –), grey
 * days that are no care days, hatched days on which the child was not in this group (or not active), the sums and the
 * remark of the month, editable in place. A click on a day number opens that day in the day list.
 */
const props = defineProps<{ initial: IsoDate; canPrint: boolean }>()
const emit = defineEmits<{ openDay: [date: IsoDate] }>()
const s = de.attendance

const start = parseIsoDate(props.initial)
const year = ref(start.year)
const month = ref(start.month)
const { data, error, refresh } = await useFetch<AttendanceMonthDto>('/api/attendance/month', { query: { year, month }, key: 'attendance-month' })
const run = useAction(refresh)
const kinds = ['present', 'sick', 'vacation', 'excused', 'unexcused'] as const
const today = todayIso()
const monthKey = computed(() => `${year.value}-${String(month.value).padStart(2, '0')}`)

function change(nextYear: number, nextMonth: number) {
  year.value = nextYear
  month.value = nextMonth
}

// One draft per child (a child that changed the group shows in two tables with the same remark); a refresh keeps an unsaved edit.
const drafts = reactive<Record<number, string>>({})
const stored = new Map<number, string>()
watch(data, (value) => {
  for (const group of value?.groups ?? []) {
    for (const child of group.children) {
      if (drafts[child.childId] === undefined || drafts[child.childId] === stored.get(child.childId)) drafts[child.childId] = child.remark
      stored.set(child.childId, child.remark)
    }
  }
}, { immediate: true })
watch(monthKey, () => {
  for (const key of Object.keys(drafts)) delete drafts[Number(key)]
  stored.clear()
})

const saving = reactive<Record<number, boolean>>({})
async function saveRemark(child: AttendanceMonthChildDto) {
  const id = child.childId
  const text = (drafts[id] ?? '').trim()
  if (text === (stored.get(id) ?? '') || saving[id]) return
  saving[id] = true
  const body: AttendanceMonthRemarkInput = { childId: id, month: monthKey.value, remark: text }
  const ok = await run(() => $fetch<unknown>('/api/attendance/month-remark', { method: 'PUT', body }), de.common.saved)
  saving[id] = false
  if (!ok) drafts[id] = stored.get(id) ?? ''
}
const blurOnEnter = (event: KeyboardEvent) => (event.target as HTMLInputElement).blur()

const dayLabel = (date: IsoDate) => `${de.weekdaysShort[weekday(date)]}, ${formatDate(date)}`
const th = 'border border-gray-200 px-1 py-1 text-center font-semibold'
const td = 'border border-gray-200 px-0.5 py-1 text-center'
const hatched = 'background-image: repeating-linear-gradient(45deg, #d1d5db 0 1px, transparent 1px 4px)'
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-3">
      <MonthNav :year="year" :month="month" @change="change" />
      <p class="text-sm text-gray-600">{{ s.monthLegend }}</p>
      <UButton
        v-if="canPrint" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="s.print"
        :to="`/print/children/attendance-month/${year}/${month}`" target="_blank"
      />
    </div>
    <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <p v-if="!data.groups.length" class="text-sm text-gray-500">{{ s.noChildren }}</p>
      <section v-for="group in data.groups" :key="group.id ?? 'none'" class="space-y-1">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ group.id === null ? s.noGroup : group.name }}</h2>
        <div class="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
          <table class="w-full border-collapse text-xs">
            <thead class="bg-gray-100 text-gray-600">
              <tr>
                <th :class="th" class="sticky left-0 z-10 bg-gray-100 text-left">{{ s.printColumns.child }}</th>
                <th v-for="day in data.days" :key="day.date" :class="[th, day.grey ? 'bg-gray-200' : '', day.date === today ? 'text-sky-700' : '']" class="p-0">
                  <button
                    type="button" class="block min-h-8 w-full min-w-6 px-0.5 hover:bg-sky-50" :title="s.month.openDay(dayLabel(day.date))"
                    :aria-label="s.month.openDay(dayLabel(day.date))" @click="emit('openDay', day.date)"
                  >
                    {{ Number(day.date.slice(8)) }}
                  </button>
                </th>
                <th v-for="kind in kinds" :key="kind" :class="th">{{ s.monthSums[kind] }}</th>
                <th :class="th" class="min-w-48 text-left">{{ s.remark }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="child in group.children" :key="child.childId">
                <th scope="row" :class="td" class="sticky left-0 z-10 whitespace-nowrap bg-white px-2 text-left font-medium">
                  <NuxtLink :to="`/children/${child.childId}`" class="text-sky-700 hover:underline">{{ child.name }}</NuxtLink>
                </th>
                <td
                  v-for="day in data.days" :key="day.date" :class="[td, day.grey ? 'bg-gray-200' : '', child.cells[day.date] === 'unexcused' ? 'text-red-700' : '']"
                  :style="child.cells[day.date] === undefined ? hatched : undefined"
                  :title="child.cells[day.date] === undefined ? s.month.notInGroup : undefined"
                >
                  {{ child.cells[day.date] ? MONTH_CELL_SYMBOL[child.cells[day.date]!] : '' }}
                </td>
                <td v-for="kind in kinds" :key="kind" :class="td" class="font-semibold">{{ child.sums[kind] || '' }}</td>
                <td :class="td" class="px-1">
                  <UInput
                    v-model="drafts[child.childId]" size="md" maxlength="500" :placeholder="s.month.remarkPlaceholder"
                    :aria-label="`${s.remark}: ${child.name}`" :disabled="saving[child.childId]" class="w-full"
                    @blur="saveRemark(child)" @keydown.enter="blurOnEnter"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
