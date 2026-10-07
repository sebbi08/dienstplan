<script setup lang="ts">
import { parseIsoDate, todayIso, weekday } from '#shared/domain/dates'
import type { LeavePlanningDto, LeaveRequestDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort } from '~/utils/format'

/** For the people responsible for leave planning: open requests, the limit and a year calendar of leave and wishes. */
const route = useRoute()
const year = ref(Number(route.query.year) || parseIsoDate(todayIso()).year)
const { data: planning, error, refresh } = await useFetch<LeavePlanningDto>('/api/leave-planning', { query: { year } })
const run = useAction(refresh)
const confirm = useConfirm()
const toast = useToast()

const limit = ref<number | null>(null)
watch(planning, value => (limit.value = value?.maxConcurrent ?? null), { immediate: true })
function saveLimit() {
  const value = limit.value === null || String(limit.value) === '' ? null : Number(limit.value)
  run(() => $fetch<unknown>('/api/leave-settings/max', { method: 'PUT', body: { value } }), de.common.saved)
}

const daysText = (dates: string[]) => dates.map(date => formatDayShort(date, weekday(date))).join(', ')

async function approve(request: LeaveRequestDto) {
  const send = (overwrite: boolean) => $fetch<unknown>(`/api/leave-requests/${request.id}/decide`, {
    method: 'POST', body: { approve: true, note: '', overwrite },
  })
  try {
    await send(false)
  }
  catch (failure) {
    const data = (failure as { data?: { data?: { code?: string; details?: { days?: number } } } }).data?.data
    if (data?.code !== 'cells_occupied') {
      toast.add({ title: errorMessage(failure), color: 'error' })
      return
    }
    if (!await confirm(de.leavePlanning.overwriteConfirm(data.details?.days ?? 0), { confirmLabel: de.leavePlanning.overwrite, danger: false })) return
    if (!await run(() => send(true))) return
  }
  await refresh()
  toast.add({ title: de.leavePlanning.approved, color: 'success' })
}

const rejecting = reactive<{ request: LeaveRequestDto | null; note: string }>({ request: null, note: '' })
const rejectOpen = computed({
  get: () => rejecting.request !== null,
  set: (open) => { if (!open) rejecting.request = null },
})
async function reject() {
  const request = rejecting.request
  if (!request) return
  const ok = await run(() => $fetch<unknown>(`/api/leave-requests/${request.id}/decide`, {
    method: 'POST', body: { approve: false, note: rejecting.note, overwrite: false },
  }), de.leavePlanning.rejected)
  if (ok) rejecting.request = null
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leavePlanning.title }}</h1>
      <YearNav v-model="year" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <template v-if="planning">
      <section class="max-w-4xl space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <h2 class="font-semibold">{{ de.leavePlanning.openRequests }}</h2>
        <p v-if="!planning.openRequests.length" class="text-sm text-gray-500">{{ de.leavePlanning.noOpenRequests }}</p>
        <div v-for="request in planning.openRequests" :key="request.id" class="space-y-1 border-t border-gray-100 pt-2 text-sm first:border-0 first:pt-0">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="font-semibold">{{ request.name }}</span>
            <span>{{ de.leavePlanning.range(formatDate(request.startDate), formatDate(request.endDate), request.workdays) }}</span>
            <span class="ml-auto flex gap-1">
              <UButton size="xs" icon="i-lucide-check" :label="de.leavePlanning.approve" @click="approve(request)" />
              <UButton
                size="xs" color="error" variant="outline" icon="i-lucide-x" :label="de.leavePlanning.reject"
                @click="Object.assign(rejecting, { request, note: '' })"
              />
            </span>
          </div>
          <p v-if="request.note" class="text-gray-600">„{{ request.note }}“</p>
          <p v-if="request.overLimitDates.length" class="font-medium text-red-700">
            {{ de.leavePlanning.overLimitDays(daysText(request.overLimitDates)) }}
          </p>
        </div>
      </section>

      <form class="flex max-w-4xl flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="saveLimit">
        <UFormField :label="de.leavePlanning.limit" :hint="de.leavePlanning.limitHint">
          <UInput v-model.number="limit" type="number" min="1" max="100" class="w-32" />
        </UFormField>
        <UButton type="submit" :label="de.common.save" />
      </form>

      <CalendarLegend planning />
      <div class="space-y-3 overflow-x-auto">
        <div v-for="month in 12" :key="month" class="min-w-[900px] rounded-lg bg-white">
          <CalendarMonth :calendar="planning.calendar" :month="month" :counts="planning.counts" :limit="planning.maxConcurrent" />
        </div>
      </div>
    </template>

    <UModal v-model:open="rejectOpen" :title="de.leavePlanning.rejectTitle">
      <template #body>
        <form class="space-y-3" @submit.prevent="reject">
          <p v-if="rejecting.request" class="text-sm">
            {{ rejecting.request.name }}: {{ formatDate(rejecting.request.startDate) }} – {{ formatDate(rejecting.request.endDate) }}
          </p>
          <UFormField :label="de.leavePlanning.reason"><UInput v-model="rejecting.note" maxlength="300" class="w-full" /></UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="rejectOpen = false" />
            <UButton type="submit" color="error" :label="de.leavePlanning.reject" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
