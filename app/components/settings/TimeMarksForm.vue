<script setup lang="ts">
import { DEFAULT_MARK_TOLERANCE, MAX_MARK_TOLERANCE, MIN_MARK_TOLERANCE } from '#shared/domain/timeMarks'
import type { TimeMarkSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Part of the Zeiterfassung section: the tolerance for late / early marks and whether early leaving is marked. */
const { data, refresh } = await useFetch<TimeMarkSettingsDto>('/api/time-mark-settings', { key: 'time-mark-settings' })
const { busy, run } = useBusyAction(refresh)
const s = de.settings

const toleranceMinutes = ref(DEFAULT_MARK_TOLERANCE)
const markEarlyLeave = ref(true)
watch(data, (value) => {
  if (!value) return
  toleranceMinutes.value = value.toleranceMinutes
  markEarlyLeave.value = value.markEarlyLeave
}, { immediate: true })
const dirty = useDirty(() => !!data.value
  && (Number(toleranceMinutes.value) !== data.value.toleranceMinutes || markEarlyLeave.value !== data.value.markEarlyLeave))

const save = () => dirty.value && run(() => $fetch<unknown>('/api/time-mark-settings', {
  method: 'PUT', body: { toleranceMinutes: toleranceMinutes.value, markEarlyLeave: markEarlyLeave.value },
}), de.common.saved)
</script>

<template>
  <form v-if="data" class="space-y-3 border-t border-gray-100 pt-3" @submit.prevent="save">
    <div class="flex flex-wrap items-end gap-4">
      <UFormField :label="s.markTolerance">
        <UInput v-model.number="toleranceMinutes" type="number" :min="MIN_MARK_TOLERANCE" :max="MAX_MARK_TOLERANCE" step="1" class="w-24" />
      </UFormField>
      <USwitch v-model="markEarlyLeave" :label="s.markEarlyLeave" class="pb-2" />
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </div>
    <p class="text-xs text-gray-500">{{ s.markHint }}</p>
  </form>
</template>
