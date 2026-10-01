<script setup lang="ts">
import { formatSignedDuration, formatTime } from '#shared/domain/time'
import type { MyTimeDto, StampAction } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate, formatSpan } from '~/utils/format'

/** Clock in/out for the signed-in employee, today's records and the own balance. */
const props = defineProps<{ time: MyTimeDto; refresh: () => Promise<unknown> }>()
const run = useAction(props.refresh)
const busy = ref(false)

const action = computed<StampAction>(() => (props.time.clockedInSince === null ? 'in' : 'out'))

async function stampNow() {
  busy.value = true
  try {
    const ok = await run(() => $fetch<unknown>('/api/my/time/stamp', { method: 'POST', body: { action: action.value } }))
    // E.g. stamped meanwhile on the tablet: reload so the button shows the real state.
    if (!ok) await props.refresh().catch(() => undefined)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        size="xl" :loading="busy" :color="action === 'in' ? 'success' : 'warning'"
        :icon="action === 'in' ? 'i-lucide-log-in' : 'i-lucide-log-out'"
        :label="action === 'in' ? de.time.clockIn : de.time.clockOut" @click="stampNow"
      />
      <span class="text-sm text-gray-600">
        {{ time.clockedInSince === null ? de.time.notClockedIn : de.time.clockedInSince(formatTime(time.clockedInSince)) }}
      </span>
    </div>
    <p class="text-sm">
      <span class="text-gray-500">{{ de.time.todayRecords }}:</span>
      {{ time.todayRecords.length ? time.todayRecords.map(formatSpan).join(' · ') : de.time.none }}
    </p>
    <UAlert v-for="date in time.openEarlier" :key="date" color="warning" variant="soft" :title="de.time.openEarlier(formatDate(date))" />
    <div class="flex flex-wrap gap-6 text-sm">
      <div>{{ de.time.balanceToday }}: <span class="font-semibold" :class="balanceClass(time.balanceToday)">{{ formatSignedDuration(time.balanceToday) }}</span></div>
      <div>{{ de.time.balanceMonthEnd }}: <span class="font-semibold" :class="balanceClass(time.balanceMonthEnd)">{{ formatSignedDuration(time.balanceMonthEnd) }}</span></div>
    </div>
  </section>
</template>
