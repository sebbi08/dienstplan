<script setup lang="ts">
import type { EntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'

const props = defineProps<{ entry: EntryDto; removable?: boolean; cellTitle?: string }>()
const emit = defineEmits<{ remove: [id: number] }>()
/** Additional breaks carry "[h:mm–h:mm]" as label; show them as "Pause h:mm–h:mm". */
const text = computed(() => (props.entry.kind === 'break' ? de.plan.breakEntry(props.entry.label.slice(1, -1)) : props.entry.label))
const title = computed(() => {
  const own = [props.entry.shortLabel, props.entry.note].filter(Boolean).join(' · ')
  return [own, props.cellTitle].filter(Boolean).join('\n') || undefined
})
</script>

<template>
  <span class="group inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs" :class="chipClasses[entry.color]" :title="title">
    {{ text }}
    <button
      v-if="removable" type="button" class="hidden leading-none opacity-60 hover:opacity-100 focus-visible:inline group-hover:inline [@media(hover:none)]:inline print:hidden"
      :aria-label="de.plan.removeEntry" @click.stop="emit('remove', entry.id)"
    >×</button>
  </span>
</template>
