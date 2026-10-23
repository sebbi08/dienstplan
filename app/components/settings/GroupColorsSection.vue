<script setup lang="ts">
import { GROUP_COLORS, type GroupColor } from '#shared/types/api'
import { de } from '~/locales/de'
import { groupColorClasses } from '~/utils/groups'

/** Leitung and Träger, on the group's page: its colour in the year calendar and the leave planning (a tap saves it). */
const props = defineProps<{ groupId: number }>()
const { data: groups, refresh } = useGroups()
const { busy, run } = useBusyAction(refresh)
const group = computed(() => groups.value?.find(candidate => candidate.id === props.groupId) ?? null)

const choices: { key: GroupColor | null; label: string; class: string }[] = [
  { key: null, label: de.groups.noColor, class: 'bg-white' },
  ...GROUP_COLORS.map(key => ({ key, label: de.groups.colorNames[key], class: groupColorClasses[key] })),
]

function choose(color: GroupColor | null) {
  const current = group.value
  if (!current || current.color === color) return
  run(() => $fetch<unknown>(`/api/groups/${current.id}/color`, { method: 'PUT', body: { color } }), de.common.saved)
}
</script>

<template>
  <section v-if="group" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.groups.colorsTitle }}</h2>
    <p class="text-xs text-gray-500">{{ de.groups.colorsHint }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="max-w-40 truncate rounded px-2 py-0.5 text-sm ring-1 ring-gray-300"
        :class="group.color ? groupColorClasses[group.color] : 'bg-white'" :title="group.name"
      >{{ group.name }}</span>
      <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="`${de.groups.colorsTitle}: ${group.name}`">
        <button
          v-for="choice in choices" :key="choice.key ?? 'none'" type="button"
          class="h-7 w-7 rounded-full ring-1 ring-gray-300 disabled:opacity-50"
          :class="[choice.class, group.color === choice.key ? 'outline-2 outline-offset-1 outline-gray-800' : '']"
          :title="choice.label" :aria-label="de.groups.colorLabel(group.name, choice.label)"
          :aria-pressed="group.color === choice.key" :disabled="busy"
          @click="choose(choice.key)"
        >
          <UIcon v-if="choice.key === null" name="i-lucide-ban" class="size-full text-gray-400" aria-hidden="true" />
        </button>
      </div>
      <span class="text-xs text-gray-500">{{ group.color ? de.groups.colorNames[group.color] : de.groups.noColor }}</span>
    </div>
  </section>
</template>
