<script setup lang="ts">
import type { GroupDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Leitung and Träger: per group of one facility the other groups its staff may also read at the tablet (one
 * direction). `source` is the facility-level read of the grants; every toggle saves the group's list at once.
 */
const props = defineProps<{ groups: GroupDto[]; source: string }>()

const KEY_PREFIX = 'group-read-access:'
const { data: grants, status, refresh } = await useFetch<Record<number, number[]>>(() => props.source, {
  key: () => `${KEY_PREFIX}${props.source}`, default: () => ({}),
})
// Until the stored grants are known, a click would replace them with a single group: no toggling then.
const loaded = computed(() => status.value === 'success')
// A new or deleted group changes the lists.
watch(() => props.groups.map(group => group.id).join(), () => refresh())

// The same grants may be on screen twice (the Träger's facility list and the Gruppenbücher block): refresh every copy.
const nuxtApp = useNuxtApp()
const refreshAll = () => refreshNuxtData(Object.keys(nuxtApp.payload.data).filter(key => key.startsWith(KEY_PREFIX)))
const { busy, run } = useBusyAction(refreshAll)

const others = (group: GroupDto) => props.groups.filter(other => other.id !== group.id)
const mayRead = (group: GroupDto, other: GroupDto) => grants.value[group.id]?.includes(other.id) ?? false

/** Lets the staff of the group also read the other group, or takes that away. */
async function setMayRead(group: GroupDto, other: GroupDto, value: boolean) {
  if (!loaded.value) return
  const ids = new Set(props.groups.map(candidate => candidate.id))
  const current = (grants.value[group.id] ?? []).filter(id => ids.has(id) && id !== other.id)
  const readable = value ? [...current, other.id] : current
  await run(() => $fetch<unknown>(`/api/groups/${group.id}/read-access`, { method: 'PUT', body: { readable } }), de.common.saved)
}
</script>

<template>
  <div v-if="groups.length > 1" class="space-y-1">
    <div v-for="group in groups" :key="group.id" class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="text-sm font-medium">{{ group.name }}</span>
      <span class="text-xs text-gray-600">{{ de.groups.mayAlsoRead }}</span>
      <UCheckbox
        v-for="other in others(group)" :key="other.id" size="sm" :model-value="mayRead(group, other)" :label="other.name"
        :aria-label="de.groups.mayAlsoReadLabel(group.name, other.name)" :disabled="busy || !loaded"
        @update:model-value="setMayRead(group, other, $event === true)"
      />
    </div>
    <p v-if="status === 'error'" class="text-xs text-red-700">{{ de.groups.readAccessLoadFailed }}</p>
    <p class="text-xs text-gray-500">{{ de.groups.readOnlyHint }}</p>
  </div>
  <p v-else class="text-xs text-gray-500">{{ de.groups.readAccessNeedsTwo }}</p>
</template>
