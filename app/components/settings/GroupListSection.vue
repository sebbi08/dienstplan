<script setup lang="ts">
import { de } from '~/locales/de'
import { groupColorClasses } from '~/utils/groups'
import { groupPath } from '~/utils/settingsAreas'

/**
 * Einstellungen → Gruppen: the groups of the active facility in their order; a tap opens the group's page with
 * everything about it. The Träger changes the order with the arrows (the plan, the Belegung, the attendance and the
 * calendars follow it); the Leitung sees the order.
 */
const { data: groups, refresh } = useGroups()
const { can } = useCan()
const canManageGroups = computed(() => can('settings.groups'))
// Lists with the groups in their order follow at once.
const { busy, run } = useBusyAction(() => Promise.all([
  refresh(), refreshNuxtData(['child-groups', 'children-occupancy', 'opening-hours', 'reminder-settings']),
]))
const s = de.settingsAreas

function move(id: number, direction: 'up' | 'down') {
  run(() => $fetch<unknown>(`/api/groups/${id}/move`, { method: 'POST', body: { direction } }))
}
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.groupList }}</h2>
    <template v-if="groups?.length">
      <p class="text-xs text-gray-500">{{ s.groupListHint }}</p>
      <ul class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
        <li v-for="(group, index) in groups" :key="group.id" class="flex items-center">
          <NuxtLink :to="groupPath(group.id)" class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
            <span
              class="h-4 w-4 shrink-0 rounded-full ring-1 ring-gray-300" :class="group.color ? groupColorClasses[group.color] : 'bg-white'"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate font-medium">{{ group.name }}</span>
            <span v-if="group.capacity !== null" class="shrink-0 text-xs text-gray-500">{{ de.capacity.groupLabel }}: {{ group.capacity }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
          </NuxtLink>
          <span v-if="canManageGroups" class="flex shrink-0 gap-0.5 pr-2">
            <UButton
              size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="s.moveUp(group.name)"
              :disabled="busy || index === 0" @click="move(group.id, 'up')"
            />
            <UButton
              size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="s.moveDown(group.name)"
              :disabled="busy || index === groups.length - 1" @click="move(group.id, 'down')"
            />
          </span>
        </li>
      </ul>
      <p v-if="canManageGroups" class="text-xs text-gray-500">{{ s.groupOrderHintList }}</p>
    </template>
    <template v-else>
      <p class="text-sm text-gray-600">{{ s.groupListNone }}</p>
      <p class="text-xs text-gray-500">{{ canManageGroups ? s.groupListNoneProvider : s.groupListNoneLeitung }}</p>
    </template>
  </section>
</template>
