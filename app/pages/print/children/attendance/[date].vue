<script setup lang="ts">
import { todayIso, weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { AttendanceChildDto, AttendanceDayDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { pickupPersonText } from '~/utils/attendance'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/** The day list of the child attendance for printing (Leitung and Träger): A4 landscape, one table per group. */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 10mm; }' }] })

const date = String(useRoute().params.date)
const { data, error } = await useFetch<AttendanceDayDto>('/api/attendance/day', { query: { date }, key: `print-children-attendance-day-${date}` })

const s = de.attendance
const c = s.printColumns
const dateText = `${de.weekdaysShort[weekday(date)]}, ${formatDate(date)}`
const sections = computed(() => (data.value?.groups ?? []).map(group => ({
  key: group.id ?? 'none',
  name: group.id === null ? s.noGroup : group.name,
  rows: (data.value?.children ?? []).filter(child => child.groupId === group.id),
})))

const time = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))
/** The arrival column: the times of the stays, or why the child is away. */
const arrivals = (child: AttendanceChildDto) => {
  if (child.stays.length > 0) return child.stays.map(stay => time(stay.arrived))
  return child.status === 'sick' || child.status === 'vacation' || child.status === 'excused' || child.status === 'unexcused'
    ? [s.absence[child.status]]
    : []
}

const th = 'border border-gray-400 px-1.5 py-1 text-left font-semibold'
const td = 'border border-gray-400 px-1.5 py-1 align-top'
</script>

<template>
  <div class="bg-white p-4 text-gray-900">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-xl font-semibold">{{ s.printDayTitle(dateText) }}</h1>
      <PrintActions :file-name="`Anwesenheit-Kinder-${date}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <p v-if="!sections.length" class="text-sm text-gray-600">{{ s.noChildren }}</p>
      <section v-for="(section, index) in sections" :key="section.key" :class="index < sections.length - 1 ? 'break-after-page' : ''" class="mb-6">
        <h2 class="mb-1 text-lg font-semibold">{{ section.name }}</h2>
        <table class="w-full border-collapse text-xs">
          <thead class="bg-gray-100">
            <tr>
              <th :class="th">{{ c.child }}</th>
              <th :class="th">{{ c.arrived }}</th>
              <th v-if="data.recordBroughtBy" :class="th">{{ c.broughtBy }}</th>
              <th :class="th">{{ c.plannedPickup }}</th>
              <th :class="th">{{ c.pickedUpBy }}</th>
              <th :class="th">{{ c.left }}</th>
              <th :class="[th, 'text-center']">{{ c.snack }}</th>
              <th :class="[th, 'text-center']">{{ c.lunch }}</th>
              <th :class="th">{{ c.info }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="child in section.rows" :key="child.childId" class="break-inside-avoid">
              <td :class="td" class="whitespace-nowrap font-medium">{{ child.name }}</td>
              <td :class="td" class="whitespace-nowrap"><div v-for="(text, i) in arrivals(child)" :key="i">{{ text }}</div></td>
              <td v-if="data.recordBroughtBy" :class="td">{{ child.broughtBy }}</td>
              <td :class="td" class="whitespace-nowrap">{{ time(child.plannedPickup) }}</td>
              <td :class="td"><div v-for="stay in child.stays" :key="stay.id">{{ pickupPersonText(stay) ?? '' }}&nbsp;</div></td>
              <td :class="td" class="whitespace-nowrap"><div v-for="stay in child.stays" :key="stay.id">{{ time(stay.left) }}&nbsp;</div></td>
              <td :class="td" class="text-center">{{ child.snack ? '✓' : '' }}</td>
              <td :class="td" class="text-center">{{ child.lunch ? '✓' : '' }}</td>
              <td :class="td" class="whitespace-pre-line break-words">
                <div v-if="child.allergies">{{ s.allergies }}: {{ child.allergies }}</div>
                <div v-if="child.note">{{ child.note }}</div>
                <template v-for="stay in child.stays" :key="stay.id">
                  <div v-if="stay.pickedUpOther && stay.pickedUpBy && stay.pickedUpConfirmedWith">{{ s.pickedUpByInfo(stay.pickedUpBy, stay.pickedUpConfirmedWith) }}</div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
