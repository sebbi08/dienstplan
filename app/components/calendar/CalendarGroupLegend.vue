<script setup lang="ts">
import type { YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { groupColorClasses } from '~/utils/groups'

/** The colours of the groups in the calendar (only groups with a colour); nothing without any. */
const props = defineProps<{ groups: YearCalendarDto['groups'] }>()
const items = computed(() => props.groups.flatMap(group => (group.color ? [{ id: group.id, name: group.name, class: groupColorClasses[group.color] }] : [])))
</script>

<template>
  <div v-if="items.length" class="flex flex-wrap gap-x-4 gap-y-1 text-xs" style="print-color-adjust: exact; -webkit-print-color-adjust: exact">
    <span class="font-medium">{{ de.groups.title }}:</span>
    <span v-for="item in items" :key="item.id" class="inline-flex items-center gap-1">
      <span class="inline-block h-3 w-6 rounded-sm ring-1 ring-gray-300" :class="item.class" /> {{ item.name }}
    </span>
  </div>
</template>
