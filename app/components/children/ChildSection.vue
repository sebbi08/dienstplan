<script setup lang="ts">
import type { SectionStamp } from '#shared/types/api'
import { de } from '~/locales/de'
import { stampText } from '~/utils/children'

/** One card of the record: title, an optional `banner` (review markers), "zuletzt geändert von … am …" (without a `stamp` none is shown) and an edit button that swaps the `edit` slot in. */
const props = defineProps<{ title: string; stamp?: SectionStamp; canEdit: boolean }>()
const editing = defineModel<boolean>('editing', { default: false })
const stamped = computed(() => (props.stamp ? stampText(props.stamp) : null))
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-start gap-3">
      <div>
        <h2 class="font-semibold">{{ title }}</h2>
        <p v-if="stamped" class="text-xs text-gray-500">{{ stamped }}</p>
      </div>
      <div class="ml-auto flex gap-2">
        <slot name="actions" />
        <UButton v-if="canEdit && !editing" size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" :label="de.common.edit" @click="editing = true" />
      </div>
    </div>
    <slot name="banner" />
    <slot v-if="editing" name="edit" />
    <slot v-else />
  </section>
</template>
