<script setup lang="ts">
import { weekday } from '#shared/domain/dates'
import type { LeaveRequestStatus, LeaveYearListDto, LeaveYearRequestDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort, formatNumber } from '~/utils/format'
import {
  LEAVE_KINDS, LEAVE_STATUSES, type LeaveFilter, encodeLeaveFilter, leaveAccountLine, rangeOriginText, timestampDate,
} from '~/utils/leaveYearList'

/**
 * „Urlaubsplanung“ → „Alle Anträge und Urlaube“ and its print view: the requests of the year (open ones decided here as
 * under „Planung“) and every person's leave periods with their origin and the leave account. Filtered on the server.
 * `print`: the print view (no filters to change, no buttons, no frames).
 */
const props = defineProps<{ year: number; print?: boolean }>()
const filter = defineModel<LeaveFilter>('filter', { required: true })
const emit = defineEmits<{ decided: [] }>()
const t = de.leaveYearList

const query = computed(() => ({
  year: props.year, employeeId: filter.value.employeeId ?? '', kind: filter.value.kind ?? '', status: filter.value.status ?? '',
}))
const { data, error, refresh } = await useFetch<LeaveYearListDto>('/api/leave-planning/all', { query })

async function decided() {
  await refresh()
  emit('decided')
}

// The selects need a value for „alle“ (Nuxt UI items cannot hold null).
const ALL = 'all'
const employeeItems = computed(() => [{ label: t.all, value: ALL }, ...(data.value?.employees ?? []).map(employee => ({ label: employee.name, value: String(employee.id) }))])
const kindItems = [{ label: t.all, value: ALL }, ...LEAVE_KINDS.map(kind => ({ label: t.kinds[kind], value: kind }))]
const statusItems = [{ label: t.all, value: ALL }, ...LEAVE_STATUSES.map(status => ({ label: t.statuses[status], value: status }))]
const employeePick = computed({
  get: () => (filter.value.employeeId === null ? ALL : String(filter.value.employeeId)),
  set: (value: string) => { filter.value = { ...filter.value, employeeId: value === ALL ? null : Number(value) } },
})
const kindPick = computed({
  get: () => filter.value.kind ?? ALL,
  set: (value: string) => { filter.value = { ...filter.value, kind: LEAVE_KINDS.find(kind => kind === value) ?? null } },
})
const statusPick = computed({
  get: () => filter.value.status ?? ALL,
  set: (value: string) => { filter.value = { ...filter.value, status: LEAVE_STATUSES.find(status => status === value) ?? null } },
})

/** The filters in words for the print view („Filter: Anna, Urlaub, offen“), empty without any. */
const filterText = computed(() => {
  const parts = [
    filter.value.employeeId === null ? null : data.value?.employees.find(employee => employee.id === filter.value.employeeId)?.name,
    filter.value.kind && t.kinds[filter.value.kind],
    filter.value.status && t.statuses[filter.value.status],
  ].filter(Boolean)
  return parts.length ? t.filterLine(parts.join(', ')) : ''
})

/** offen, abgelehnt, zurückgezogen: such requests wrote no leave days, so the section says so instead of looking empty. */
const noLeaveStatus = computed(() => ['open', 'rejected', 'withdrawn'].includes(filter.value.status ?? ''))

const STATUS_COLOR: Record<LeaveRequestStatus, 'warning' | 'success' | 'error' | 'neutral'> = {
  open: 'warning', approved: 'success', rejected: 'error', withdrawn: 'neutral',
}
const period = (from: string, to: string) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`)
const decidedText = (request: LeaveYearRequestDto) =>
  (request.decidedAt ? t.decidedText(request.decidedBy ?? '', timestampDate(request.decidedAt)) : '')
const daysText = (dates: string[]) => dates.map(date => formatDayShort(date, weekday(date))).join(', ')
const cell = 'py-1 pr-3 align-top'
</script>

<template>
  <div class="space-y-4">
    <div v-if="!props.print" class="flex flex-wrap items-end gap-3">
      <UFormField :label="t.employee"><USelect v-model="employeePick" :items="employeeItems" class="w-48" /></UFormField>
      <UFormField :label="t.kind"><USelect v-model="kindPick" :items="kindItems" class="w-40" /></UFormField>
      <UFormField :label="t.status"><USelect v-model="statusPick" :items="statusItems" class="w-48" /></UFormField>
      <UButton
        class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="t.print"
        :to="`/admin/print/leave-list/${props.year}/${encodeLeaveFilter(filter)}`" target="_blank"
      />
    </div>
    <p v-if="!props.print" class="max-w-4xl text-xs text-gray-500">{{ t.hint }}</p>
    <p v-else-if="filterText" class="text-sm">{{ filterText }}</p>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <template v-if="data">
      <section :class="props.print ? 'space-y-2' : 'space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200'">
        <h2 class="font-semibold">{{ t.requests }}</h2>
        <p v-if="!data.requests.length" class="text-sm text-gray-500">{{ t.noRequests }}</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-left">
                <th :class="cell">{{ t.employee }}</th><th :class="cell">{{ t.period }}</th>
                <th :class="[cell, 'text-right']">{{ t.days }}</th><th :class="cell">{{ t.kind }}</th>
                <th :class="cell">{{ t.createdAt }}</th><th :class="cell">{{ t.status }}</th>
                <th :class="cell">{{ t.decided }}</th><th :class="cell">{{ t.reason }}</th>
                <th v-if="!props.print" class="py-1"><span class="sr-only">{{ t.action }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="request in data.requests" :key="request.id" class="border-b border-gray-100">
                <td :class="cell">{{ request.name }}</td>
                <td :class="[cell, 'whitespace-nowrap']">{{ period(request.startDate, request.endDate) }}</td>
                <td :class="[cell, 'text-right tabular-nums']">{{ formatNumber(request.workdays) }}</td>
                <td :class="cell">{{ t.kinds[request.kind] }}</td>
                <td :class="[cell, 'whitespace-nowrap']">{{ timestampDate(request.createdAt) }}</td>
                <td :class="cell">
                  <span v-if="props.print">{{ t.statuses[request.status] }}</span>
                  <UBadge v-else :color="STATUS_COLOR[request.status]" variant="soft" :label="t.statuses[request.status]" />
                  <p v-if="request.overLimitDates.length" class="text-xs font-medium text-purple-700">
                    {{ de.leavePlanning.overLimitDays(daysText(request.overLimitDates)) }}
                  </p>
                </td>
                <td :class="cell">{{ decidedText(request) }}</td>
                <td :class="cell">{{ request.status === 'rejected' ? request.decisionNote : '' }}</td>
                <td v-if="!props.print" class="py-1 text-right">
                  <LeaveDecisionButtons v-if="request.canDecide" :request="request" @decided="decided" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section :class="props.print ? 'space-y-3' : 'space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200'">
        <h2 class="font-semibold">{{ t.leave }}</h2>
        <p v-if="noLeaveStatus" class="text-sm text-gray-500">{{ t.noLeaveForStatus }}</p>
        <p v-else-if="!data.people.length" class="text-sm text-gray-500">{{ t.noLeave }}</p>
        <div v-for="person in data.people" :key="person.employeeId" class="space-y-1 border-t border-gray-100 pt-2 first-of-type:border-0" style="break-inside: avoid">
          <div class="flex flex-wrap items-baseline gap-x-3">
            <h3 class="font-semibold">{{ person.name }}</h3>
            <span class="text-sm text-gray-700">{{ leaveAccountLine(person.account, person.hasEntitlement, person.extraDays) }}</span>
          </div>
          <p v-if="!person.ranges.length" class="text-sm text-gray-500">{{ t.noRanges }}</p>
          <table v-else class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-left text-xs text-gray-600">
                <th :class="[cell, 'font-normal']">{{ t.period }}</th><th :class="[cell, 'text-right font-normal']">{{ t.days }}</th>
                <th :class="[cell, 'font-normal']">{{ t.kind }}</th><th :class="[cell, 'font-normal']">{{ t.origin }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="range in person.ranges" :key="`${range.kind}-${range.from}-${range.origin}`" class="border-b border-gray-50">
                <td :class="[cell, 'whitespace-nowrap']">{{ period(range.from, range.to) }}</td>
                <td :class="[cell, 'text-right tabular-nums']">{{ formatNumber(range.days) }}</td>
                <td :class="cell">{{ t.kinds[range.kind] }}</td>
                <td :class="cell">{{ rangeOriginText(range) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
