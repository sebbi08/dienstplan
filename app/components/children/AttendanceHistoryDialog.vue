<script setup lang="ts">
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceChangeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { historyFieldLabel, historyValueText } from '~/utils/attendance'
import { errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'

/** The changes of a child's day, newest first: field, before → after, who and when (spec §3.9). */
const props = defineProps<{ childId: number; name: string; date: IsoDate }>()
const open = defineModel<boolean>('open', { default: false })
const s = de.attendance.history

const entries = ref<AttendanceChangeDto[] | null>(null)
const error = ref('')
watch(open, async (value) => {
  if (!value) return
  entries.value = null
  error.value = ''
  try {
    entries.value = await $fetch<AttendanceChangeDto[]>('/api/attendance/history', { query: { childId: props.childId, date: props.date } })
  }
  catch (failure) {
    error.value = errorMessage(failure)
  }
}, { immediate: true })
</script>

<template>
  <UModal v-model:open="open" :title="s.title(name)">
    <template #body>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <p v-else-if="!entries" class="text-sm text-gray-500"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /></p>
      <p v-else-if="!entries.length" class="text-sm text-gray-500">{{ s.empty }}</p>
      <ul v-else class="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
        <li v-for="entry in entries" :key="entry.id" class="py-2">
          <p class="text-sm font-medium">{{ historyFieldLabel(entry.field) }}</p>
          <p class="whitespace-pre-line break-words text-sm">
            <span class="text-gray-500">{{ historyValueText(entry.field, entry.before) }}</span>
            <span class="px-1" aria-hidden="true">→</span>
            <span>{{ historyValueText(entry.field, entry.after) }}</span>
          </p>
          <p class="text-xs text-gray-500">{{ s.by(entry.changedByName, formatDateTime(entry.changedAt)) }}</p>
        </li>
      </ul>
      <div class="mt-4 flex justify-end">
        <UButton size="xl" color="neutral" variant="ghost" :label="de.common.close" @click="open = false" />
      </div>
    </template>
  </UModal>
</template>
