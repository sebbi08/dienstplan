<script setup lang="ts">
import { todayIso, weekday } from '#shared/domain/dates'
import type { LeaveRequestDto, LeaveRequestPreviewDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort, formatNumber } from '~/utils/format'

/** "Urlaub beantragen" and the own requests with their status (only shown while the module is active). */
const emit = defineEmits<{ changed: [] }>()
const { data: requests, refresh } = await useFetch<LeaveRequestDto[]>('/api/my/leave-requests')
const run = useAction(async () => {
  await refresh()
  emit('changed')
})
const confirm = useConfirm()

const today = todayIso()
const form = reactive({ from: today, to: today, note: '' })
const preview = ref<LeaveRequestPreviewDto | null>(null)
const previewError = ref('')
watch(() => [form.from, form.to], async ([from, to]) => {
  preview.value = null
  previewError.value = ''
  if (!from || !to) return
  try {
    preview.value = await $fetch<LeaveRequestPreviewDto>('/api/my/leave-requests/preview', { query: { from, to } })
  }
  catch (failure) {
    previewError.value = errorMessage(failure)
  }
}, { immediate: true })

const daysText = (dates: string[]) => dates.map(date => formatDayShort(date, weekday(date))).join(', ')

async function send() {
  const ok = await run(() => $fetch<unknown>('/api/my/leave-requests', { method: 'POST', body: { ...form } }), de.leaveRequests.sent)
  if (ok) Object.assign(form, { from: today, to: today, note: '' })
}

async function withdraw(request: LeaveRequestDto) {
  if (!await confirm(de.leaveRequests.withdrawConfirm, { confirmLabel: de.leaveRequests.withdraw })) return
  run(() => $fetch<unknown>(`/api/my/leave-requests/${request.id}/withdraw`, { method: 'POST' }), de.leaveRequests.withdrawn)
}

const STATUS_COLOR = { open: 'warning', approved: 'success', rejected: 'error', withdrawn: 'neutral' } as const
</script>

<template>
  <section class="space-y-4 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <form class="space-y-3" @submit.prevent="send">
      <h2 class="font-semibold">{{ de.leaveRequests.title }}</h2>
      <div class="grid gap-3 sm:grid-cols-3">
        <UFormField :label="de.leaveRequests.from"><UInput v-model="form.from" type="date" :min="today" class="w-full" required /></UFormField>
        <UFormField :label="de.leaveRequests.to"><UInput v-model="form.to" type="date" :min="form.from" class="w-full" required /></UFormField>
        <UFormField :label="de.leaveRequests.note"><UInput v-model="form.note" maxlength="300" class="w-full" /></UFormField>
      </div>
      <p v-if="previewError" class="text-sm text-red-700">{{ previewError }}</p>
      <p v-else-if="preview" class="text-sm">
        {{ de.leaveRequests.preview(preview.workdays) }}<template v-if="preview.availableAfter !== null">, {{ de.leaveRequests.availableAfter(formatNumber(preview.availableAfter)) }}</template>
      </p>
      <p v-if="preview?.overLimitDates.length" class="text-sm font-medium text-amber-700">
        {{ de.leaveRequests.overLimitHint(daysText(preview.overLimitDates)) }}
      </p>
      <UButton type="submit" icon="i-lucide-send" :label="de.leaveRequests.send" :disabled="!preview" />
    </form>

    <div class="space-y-2">
      <h2 class="font-semibold">{{ de.leaveRequests.mine }}</h2>
      <p v-if="!requests?.length" class="text-sm text-gray-500">{{ de.leaveRequests.none }}</p>
      <ul v-else class="divide-y divide-gray-100 text-sm">
        <li v-for="request in requests" :key="request.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span>{{ formatDate(request.startDate) }} – {{ formatDate(request.endDate) }}</span>
          <span class="text-gray-500">{{ de.leaveRequests.preview(request.workdays) }}</span>
          <UBadge :color="STATUS_COLOR[request.status]" variant="soft" :label="de.leaveRequests.status[request.status]" />
          <span v-if="request.decidedBy && request.status !== 'withdrawn'" class="text-xs text-gray-500">{{ de.leaveRequests.decidedBy(request.decidedBy) }}</span>
          <span v-if="request.decisionNote" class="text-xs text-gray-600">„{{ request.decisionNote }}“</span>
          <UButton
            v-if="request.status === 'open'" class="ml-auto" size="xs" color="neutral" variant="ghost"
            :label="de.leaveRequests.withdraw" @click="withdraw(request)"
          />
        </li>
      </ul>
    </div>
  </section>
</template>
