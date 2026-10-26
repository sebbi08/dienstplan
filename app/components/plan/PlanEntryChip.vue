<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { EntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'

/**
 * `editable`: a click on the chip opens the edit dialog (the parent handles the click). `groupName`: the duty counts for
 * this group instead of the person's home group (shown as a small tag).
 */
const props = defineProps<{ entry: EntryDto; removable?: boolean; editable?: boolean; cellTitle?: string; groupName?: string | null }>()
const emit = defineEmits<{ remove: [id: number] }>()

/** Additional breaks carry "[h:mm–h:mm]" as label; show them as "Pause h:mm–h:mm". */
const text = computed(() => (props.entry.kind === 'break' ? de.plan.breakEntry(props.entry.label.slice(1, -1)) : props.entry.label))
/** The break inside a shift (fixed or changed), shown as its own red line under the shift time. */
const breakText = computed(() => {
  const { breakStart, breakEnd } = props.entry
  return breakStart !== null && breakEnd !== null ? de.plan.breakEntry(`${formatTime(breakStart)}–${formatTime(breakEnd)}`) : null
})
const title = computed(() => {
  const own = [props.entry.shortLabel, props.entry.note, props.groupName ? de.groups.tagHint(props.groupName) : ''].filter(Boolean).join(' · ')
  return [own, props.editable ? de.plan.editEntryHint : '', props.cellTitle].filter(Boolean).join('\n') || undefined
})
</script>

<template>
  <span
    class="group inline-flex items-start gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs"
    :class="[chipClasses[entry.color], editable ? 'cursor-pointer ring-1 ring-sky-400 hover:ring-2' : '']" :title="title"
  >
    <span class="flex flex-col">
      <span class="print:leading-[1.1]!">{{ text }}</span>
      <!-- Printed small and grey: the shift time stays the main information. -->
      <span v-if="breakText" class="text-[11px] leading-tight text-red-700 print:text-[0.65rem] print:leading-none! print:text-gray-500">{{ breakText }}</span>
      <span v-if="groupName" class="text-[11px] font-medium leading-tight text-violet-800">{{ de.groups.tag(groupName) }}</span>
    </span>
    <button
      v-if="removable" type="button" class="hidden leading-none opacity-60 hover:opacity-100 focus-visible:inline group-hover:inline [@media(hover:none)]:inline print:hidden"
      :aria-label="de.plan.removeEntry" @click.stop="emit('remove', entry.id)"
    >×</button>
  </span>
</template>
