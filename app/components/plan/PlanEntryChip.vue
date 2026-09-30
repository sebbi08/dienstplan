<script setup lang="ts">
import type { EntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'

const props = defineProps<{ entry: EntryDto; removable?: boolean }>()
const emit = defineEmits<{ remove: [id: number] }>()
const title = computed(() => [props.entry.shortLabel, props.entry.note].filter(Boolean).join(' · ') || undefined)
</script>

<template>
  <span class="group inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs" :class="chipClasses[entry.color]" :title="title">
    {{ entry.label }}
    <button
      v-if="removable" type="button" class="hidden leading-none opacity-60 hover:opacity-100 group-hover:inline print:hidden"
      :aria-label="de.plan.removeEntry" @click.stop="emit('remove', entry.id)"
    >×</button>
  </span>
</template>
