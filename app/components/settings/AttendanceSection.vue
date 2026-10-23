<script setup lang="ts">
import type { AttendanceSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Whether the tablet asks who brought a child, and the day attendance is recorded from (Leitung and Träger); below,
 * the facility's meals (MealsSection).
 */
const { data, refresh } = await useFetch<AttendanceSettingsDto>('/api/attendance-settings', { key: 'attendance-settings' })
const { busy, run } = useBusyAction(refresh)
const s = de.attendance

const recordBroughtBy = ref(false)
const attendanceSince = ref('')
watch(data, (value) => {
  if (!value) return
  recordBroughtBy.value = value.recordBroughtBy
  attendanceSince.value = value.attendanceSince ?? ''
}, { immediate: true })

const dirty = useDirty(() => !!data.value
  && (recordBroughtBy.value !== data.value.recordBroughtBy || attendanceSince.value !== (data.value.attendanceSince ?? '')))
const save = () => dirty.value && run(() => $fetch<unknown>('/api/attendance-settings', {
  method: 'PUT',
  body: { recordBroughtBy: recordBroughtBy.value, attendanceSince: attendanceSince.value === '' ? null : attendanceSince.value },
}), de.common.saved)
</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settingsAreas.attendance }}</h2>
    <form class="space-y-3" @submit.prevent="save">
      <USwitch v-model="recordBroughtBy" :label="s.recordBroughtBy" />
      <UFormField :label="s.attendanceSince" :help="s.attendanceSinceHint">
        <div class="flex flex-wrap items-center gap-2">
          <UInput v-model="attendanceSince" type="date" class="w-44" />
          <span v-if="attendanceSince === ''" class="text-sm text-gray-500">{{ s.attendanceSinceEmpty }}</span>
        </div>
      </UFormField>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ s.settingsHint }}</p>
    <SettingsMealsSection />
  </section>
</template>
