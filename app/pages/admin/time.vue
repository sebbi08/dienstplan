<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { formatDuration, formatSignedDuration, formatTime } from '#shared/domain/time'
import type { CodeDto, EmployeeListItemDto, OpenRecordDto, TimeDayDto, TimeMonthDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatDateTime, formatDayShort, formatSpan } from '~/utils/format'
import { warningText } from '~/utils/warnings'

/** Same tolerance as the "Ist" marker in the plan (spec 4.3). */
const DEVIATION_MINUTES = 15

const route = useRoute()
const router = useRouter()
const todayDate = todayIso()
const today = parseIsoDate(todayDate)
const year = ref(Number(route.query.year) || today.year)
const month = ref(Number(route.query.month) || today.month)
const employeeId = ref<number | null>(Number(route.query.employee) || null)
const focusDate = ref(typeof route.query.date === 'string' ? route.query.date : null)

const { data: employees } = await useFetch<EmployeeListItemDto[]>('/api/employees')
if (employeeId.value === null) employeeId.value = employees.value?.[0]?.id ?? null
const { data: openRecords, refresh: refreshOpen } = await useFetch<OpenRecordDto[]>('/api/time-records/open')
const { data, refresh } = await useFetch<TimeMonthDto>('/api/time-records', {
  query: { employeeId, year, month }, immediate: employeeId.value !== null, watch: [employeeId, year, month],
})
const run = useAction(async () => {
  await refresh()
  await refreshOpen()
})
const confirm = useConfirm()

watch([employeeId, year, month], () => router.replace({ query: { employee: employeeId.value ?? undefined, year: year.value, month: month.value } }))

const names = computed(() => new Map((employees.value ?? []).map(employee => [employee.id, employee.name])))
/** Recorded minus planned credit, only where records count (not on Urlaub/Krank/Feiertag … days). */
const difference = (day: TimeDayDto) => (day.usesRecords && !day.targetCredit ? day.recordedMinutes - day.plannedMinutes : null)
const expanded = ref(new Set<string>())

function toggleProtocol(date: string) {
  const next = new Set(expanded.value)
  if (next.has(date)) next.delete(date)
  else next.add(date)
  expanded.value = next
}

const modal = reactive<{ open: boolean; date: string; record: TimeRecordDto | null }>({ open: false, date: '', record: null })
const modalTitle = computed(() => `${modal.record ? de.common.edit : de.time.addRecord} · ${formatDate(modal.date || todayIso())}`)
function addRecord(day: TimeDayDto) {
  Object.assign(modal, { open: true, date: day.date, record: null })
}
function editRecord(day: TimeDayDto, record: TimeRecordDto) {
  Object.assign(modal, { open: true, date: day.date, record })
}
/** The dialog stays open until saving succeeded, so a rejected entry (overlap, future) keeps the typed times. */
async function onSubmit(value: { start: number; end: number }) {
  const record = modal.record
  const shownEmployee = data.value?.employee.id
  let saved = false
  if (record) saved = await run(() => $fetch<unknown>(`/api/time-records/${record.id}`, { method: 'PUT', body: value }), de.common.saved)
  else if (shownEmployee !== undefined) {
    const body = { employeeId: shownEmployee, date: modal.date, ...value }
    saved = await run(() => $fetch<unknown>('/api/time-records', { method: 'POST', body }), de.common.saved)
  }
  if (saved) modal.open = false
}
async function removeRecord(record: TimeRecordDto) {
  if (await confirm(de.time.deleteConfirm)) run(() => $fetch<unknown>(`/api/time-records/${record.id}`, { method: 'DELETE' }), de.common.deleted)
}

/** Absences are plan entries: they replace the day in the plan (shown there as unreleased change). */
async function setAbsence(day: TimeDayDto, code: CodeDto | null) {
  if (!data.value) return
  if (!code && !await confirm(de.time.removeAbsenceConfirm)) return
  if (code && day.otherEntries && !await confirm(de.time.replaceConfirm, { confirmLabel: code.label, danger: false })) return
  // Employee of the displayed table, not the select (which may already show the next person while loading).
  const cells = [{ employeeId: data.value.employee.id, date: day.date }]
  const body = code ? { cells, mode: 'replace', entry: { kind: 'code', codeId: code.id } } : { cells, mode: 'clear', entry: null }
  run(() => $fetch<unknown>('/api/entries', { method: 'POST', body }), de.common.saved)
}

/** One compact menu per day instead of four buttons, so rows stay short on narrow screens. */
function absenceItems(day: TimeDayDto): DropdownMenuItem[][] {
  const codes = (data.value?.absenceCodes ?? []).map(code => ({ label: code.label, onSelect: () => setAbsence(day, code) }))
  if (!day.absence) return [codes]
  return [codes, [{ label: de.time.removeAbsence, icon: 'i-lucide-x', color: 'error', onSelect: () => setAbsence(day, null) }]]
}

// Scroll to the focused day (deep link, "Offene Zeiträume") once its row has rendered – only then, not after every save.
const scrollPending = ref(focusDate.value !== null)
async function scrollToFocus() {
  if (!scrollPending.value || !focusDate.value) return
  await nextTick()
  const row = document.getElementById(`day-${focusDate.value}`)
  if (!row) return
  scrollPending.value = false
  row.scrollIntoView({ block: 'center' })
}
watch(data, scrollToFocus, { flush: 'post' })
onMounted(scrollToFocus)

function openJump(record: OpenRecordDto) {
  const date = parseIsoDate(record.date)
  year.value = date.year
  month.value = date.month
  employeeId.value = record.employeeId
  focusDate.value = record.date
  scrollPending.value = true
  scrollToFocus()
}

function change(nextYear: number, nextMonth: number) {
  year.value = nextYear
  month.value = nextMonth
}
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-2xl font-semibold">{{ de.time.title }}</span>
      <MonthNav :year="year" :month="month" @change="change" />
      <select v-model="employeeId" class="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm" :aria-label="de.time.employee">
        <option v-for="employee in employees ?? []" :key="employee.id" :value="employee.id">{{ employee.name }}</option>
      </select>
    </div>

    <UAlert v-if="data && !data.trackingFrom" color="neutral" variant="soft" :title="de.time.disabled" />

    <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <h2 class="mb-2 font-semibold">{{ de.time.openRecords }}</h2>
      <p v-if="!openRecords?.length" class="text-sm text-gray-500">{{ de.time.noOpenRecords }}</p>
      <ul v-else class="space-y-1 text-sm">
        <li v-for="record in openRecords" :key="record.id">
          <button type="button" class="hover:underline" @click="openJump(record)">
            {{ formatDate(record.date) }} · {{ record.name }} · {{ formatTime(record.start) }}–…
          </button>
        </li>
      </ul>
    </section>

    <table v-if="data" class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-2 py-2">{{ de.plan.date }}</th><th class="px-2 py-2">{{ de.time.planned }}</th>
          <th class="px-2 py-2">{{ de.time.records }}</th><th class="px-2 py-2 text-right">{{ de.time.recorded }}</th>
          <th class="px-2 py-2 text-right">{{ de.time.difference }}</th><th class="px-2 py-2">{{ de.time.hints }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="day in data.days" :key="day.date">
          <tr :id="`day-${day.date}`" class="border-t border-gray-100 align-top" :class="[day.isWeekend ? 'bg-gray-50 text-gray-500' : '', focusDate === day.date ? 'ring-2 ring-inset ring-sky-500' : '']">
            <td class="whitespace-nowrap px-2 py-1.5 font-medium">{{ formatDayShort(day.date, day.weekday) }}</td>
            <td class="px-2 py-1.5 text-xs">
              {{ day.plan }}
              <div class="mt-1">
                <UDropdownMenu :items="absenceItems(day)">
                  <UButton size="xs" color="neutral" variant="soft" :label="de.time.absence" trailing-icon="i-lucide-chevron-down" />
                </UDropdownMenu>
              </div>
            </td>
            <td class="px-2 py-1.5">
              <div v-for="record in day.records" :key="record.id" class="flex items-center gap-1">
                <button type="button" class="hover:underline" @click="editRecord(day, record)">{{ formatSpan(record) }}</button>
                <span v-if="record.edited" class="text-xs text-amber-700" :title="record.editedAt ? `${record.editedBy ?? ''} ${formatDateTime(record.editedAt)}` : undefined">({{ record.source === 'admin' ? de.time.edited : de.time.changed }})</span>
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="removeRecord(record)" />
              </div>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" :label="de.time.addRecord" @click="addRecord(day)" />
              <button v-if="day.changes.length" type="button" class="block text-xs text-gray-500 hover:underline" @click="toggleProtocol(day.date)">{{ de.time.protocol }} ({{ day.changes.length }})</button>
            </td>
            <td class="px-2 py-1.5 text-right">
              <span v-if="day.usesRecords">{{ formatDuration(day.recordedMinutes) }}</span>
              <span v-else class="text-xs text-gray-400" :title="day.date >= todayDate ? de.time.todayPlanned : de.time.beforeStart">–</span>
            </td>
            <td class="px-2 py-1.5 text-right font-medium">
              <span v-if="difference(day) !== null" :class="Math.abs(difference(day)!) > DEVIATION_MINUTES ? 'text-orange-600' : ''">
                {{ formatSignedDuration(difference(day)!) }}
              </span>
            </td>
            <td class="px-2 py-1.5 text-xs text-amber-700">
              <div v-for="(warning, index) in day.warnings" :key="index">{{ warningText(warning, names) }}</div>
            </td>
          </tr>
          <tr v-if="expanded.has(day.date)" class="bg-gray-50 text-xs text-gray-600">
            <td />
            <td colspan="5" class="px-2 py-1.5">
              <div v-for="(entry, index) in day.changes" :key="index">{{ formatDateTime(entry.at) }} · {{ entry.actor ?? '?' }}: {{ entry.before }} → {{ entry.after }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <TimeRecordModal v-model:open="modal.open" :title="modalTitle" :initial="modal.record" @submit="onSubmit" />
  </div>
</template>
