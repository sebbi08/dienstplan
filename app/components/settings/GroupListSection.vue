<script setup lang="ts">
import { de } from '~/locales/de'
import { groupColorClasses } from '~/utils/groups'
import { groupPath } from '~/utils/settingsAreas'

/** Einstellungen → Gruppen: the groups of the active facility; a tap opens the group's page with everything about it. */
const { data: groups } = useGroups()
const { user } = useUserSession()
const isProvider = computed(() => user.value?.role === 'provider')
const s = de.settingsAreas
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.groupList }}</h2>
    <template v-if="groups?.length">
      <p class="text-xs text-gray-500">{{ s.groupListHint }}</p>
      <ul class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
        <li v-for="group in groups" :key="group.id">
          <NuxtLink :to="groupPath(group.id)" class="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
            <span
              class="h-4 w-4 shrink-0 rounded-full ring-1 ring-gray-300" :class="group.color ? groupColorClasses[group.color] : 'bg-white'"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate font-medium">{{ group.name }}</span>
            <span v-if="group.capacity !== null" class="shrink-0 text-xs text-gray-500">{{ de.capacity.groupLabel }}: {{ group.capacity }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
          </NuxtLink>
        </li>
      </ul>
    </template>
    <template v-else>
      <p class="text-sm text-gray-600">{{ s.groupListNone }}</p>
      <p class="text-xs text-gray-500">{{ isProvider ? s.groupListNoneProvider : s.groupListNoneLeitung }}</p>
    </template>
  </section>
</template>
