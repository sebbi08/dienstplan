<script setup lang="ts">
import type { GroupColor, NoteDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatDateTime } from '~/utils/format'
import { groupColorClasses } from '~/utils/groups'

/**
 * One note of the page „Notizen“: the text (line breaks kept), „Einrichtung“ or the group in its colour, who wrote and
 * changed it and, if set, until when it applies; edit and delete for whoever may change it (`note.canEdit`).
 */
const props = defineProps<{ note: NoteDto; groupColor: GroupColor | null }>()
defineEmits<{ edit: []; remove: [] }>()

const t = de.notes
// A group without a colour (or deleted meanwhile, then the note is the facility's) gets a neutral badge.
const badgeClass = computed(() => (props.groupColor ? groupColorClasses[props.groupColor] : 'bg-gray-100 text-gray-700'))
</script>

<template>
  <li class="min-w-0 space-y-2 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4">
    <div class="flex flex-wrap items-start gap-2">
      <UBadge v-if="note.groupId === null" color="neutral" variant="outline" size="sm" :label="t.wholeFacility" />
      <span v-else class="rounded-md px-1.5 py-0.5 text-xs font-medium" :class="badgeClass">{{ note.groupName }}</span>
      <span v-if="note.validUntil" class="text-xs text-gray-600">{{ t.until(formatDate(note.validUntil)) }}</span>
      <div v-if="note.canEdit" class="ml-auto flex gap-1">
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t.edit" :title="t.edit" @click="$emit('edit')" />
        <UButton
          size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :title="de.common.delete"
          @click="$emit('remove')"
        />
      </div>
    </div>
    <p class="break-words whitespace-pre-line">{{ note.text }}</p>
    <p class="text-xs text-gray-500">
      {{ t.by(note.createdBy, formatDateTime(note.createdAt)) }}
      <template v-if="note.updatedAt && note.updatedBy">
        · {{ t.changedBy(note.updatedBy, formatDateTime(note.updatedAt)) }}
      </template>
    </p>
  </li>
</template>
