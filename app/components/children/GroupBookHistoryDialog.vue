<script setup lang="ts">
import type { IsoDate } from '#shared/domain/types'
import type { GroupBookChangeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'

/** The changes of one field of a group's weekly overview (the week's theme or a day's text), newest first. */
const props = defineProps<{ groupId: number; field: 'week' | 'day'; date: IsoDate; title: string }>()
const open = defineModel<boolean>('open', { default: false })
const s = de.groupBook.history

const entries = ref<GroupBookChangeDto[] | null>(null)
const error = ref('')
watch(open, async (value) => {
  if (!value) return
  entries.value = null
  error.value = ''
  try {
    entries.value = await $fetch<GroupBookChangeDto[]>('/api/group-book/history', {
      query: { groupId: props.groupId, field: props.field, date: props.date },
    })
  }
  catch (failure) {
    error.value = errorMessage(failure)
  }
}, { immediate: true })
</script>

<template>
  <UModal v-model:open="open" :title="s.title(title)">
    <template #body>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <p v-else-if="!entries" class="text-sm text-gray-500"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /></p>
      <p v-else-if="!entries.length" class="text-sm text-gray-500">{{ s.empty }}</p>
      <ul v-else class="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
        <li v-for="entry in entries" :key="entry.id" class="py-2">
          <p class="whitespace-pre-line break-words text-sm">
            <span class="text-gray-500">{{ entry.before || s.emptyValue }}</span>
            <span class="px-1" aria-hidden="true">→</span>
            <span>{{ entry.after || s.emptyValue }}</span>
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
