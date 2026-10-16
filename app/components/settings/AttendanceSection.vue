<script setup lang="ts">
import { formatTime, parseTime } from '#shared/domain/time'
import type { AttendanceSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** The times snack and lunch are counted at and whether the tablet asks who brought a child (Leitung and Träger). */
const { data, refresh } = await useFetch<AttendanceSettingsDto>('/api/attendance-settings', { key: 'attendance-settings' })
const { busy, run } = useBusyAction(refresh)
const s = de.attendance

const snackTime = ref('9:30')
const lunchTime = ref('12:00')
const recordBroughtBy = ref(false)
watch(data, (value) => {
  if (!value) return
  snackTime.value = formatTime(value.snackTime)
  lunchTime.value = formatTime(value.lunchTime)
  recordBroughtBy.value = value.recordBroughtBy
}, { immediate: true })

// An unreadable time goes to the server as -1, which answers with the German hint about the valid range.
const save = () => run(() => $fetch<unknown>('/api/attendance-settings', {
  method: 'PUT',
  body: {
    snackTime: parseTime(snackTime.value) ?? -1, lunchTime: parseTime(lunchTime.value) ?? -1, recordBroughtBy: recordBroughtBy.value,
  },
}), de.common.saved)
</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.settingsTitle }}</h2>
    <form class="space-y-3" @submit.prevent="save">
      <UFormField :label="s.snackTime">
        <TimeInput v-model="snackTime" any-minute class="w-24" required />
      </UFormField>
      <UFormField :label="s.lunchTime">
        <TimeInput v-model="lunchTime" any-minute class="w-24" required />
      </UFormField>
      <USwitch v-model="recordBroughtBy" :label="s.recordBroughtBy" />
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
    </form>
    <p class="text-xs text-gray-500">{{ s.settingsHint }}</p>
  </section>
</template>
