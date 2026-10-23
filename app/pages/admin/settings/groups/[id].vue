<script setup lang="ts">
import { de } from '~/locales/de'
import { groupColorClasses } from '~/utils/groups'
import { areaPath, GROUP_SECTIONS, sectionAnchor } from '~/utils/settingsAreas'

/**
 * The page of one group of the active facility (/admin/settings/groups/<id>): everything about it in one place. Each
 * block saves on its own and keeps the rights it had in the former single settings page.
 */
const route = useRoute()
const groupId = computed(() => Number(route.params.id))
const groupsFetch = useGroups()
const { data: groups } = groupsFetch
const group = computed(() => groups.value?.find(candidate => candidate.id === groupId.value) ?? null)
const s = de.settingsAreas
// A group that is not one of the active facility's (unknown, deleted or another facility's): the error page.
await groupsFetch
if (groupsFetch.error.value) throw createError({ statusCode: groupsFetch.error.value.statusCode ?? 500, fatal: true })
if (!group.value) throw createError({ statusCode: 404, statusMessage: s.groupNotFound, fatal: true })
</script>

<template>
  <div class="space-y-4">
    <NuxtLink :to="areaPath('groups')" class="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
      <UIcon name="i-lucide-chevron-left" class="size-4" aria-hidden="true" /> {{ s.areas.groups }}
    </NuxtLink>
    <template v-if="group">
      <h2 class="flex flex-wrap items-center gap-2 text-xl font-semibold">
        <span class="h-4 w-4 rounded-full ring-1 ring-gray-300" :class="group.color ? groupColorClasses[group.color] : 'bg-white'" aria-hidden="true" />
        <span class="min-w-0 break-words">{{ group.name }}</span>
        <span class="text-sm font-normal text-gray-500">{{ s.groupPage }}</span>
      </h2>
      <div v-for="section in GROUP_SECTIONS" :id="sectionAnchor(section.key)" :key="section.key" class="scroll-mt-20 empty:hidden">
        <SettingsGroupNameSection v-if="section.key === 'group-name'" :group-id="group.id" />
        <SettingsGroupColorsSection v-else-if="section.key === 'group-color'" :group-id="group.id" />
        <SettingsGroupCapacitySection v-else-if="section.key === 'group-capacity'" :group-id="group.id" />
        <SettingsGroupTypesSection v-else-if="section.key === 'group-type'" :group-id="group.id" />
        <SettingsOpeningHoursSection v-else-if="section.key === 'group-hours'" :group-id="group.id" />
        <SettingsRemindersSection v-else-if="section.key === 'group-documentation'" :group-id="group.id" />
        <SettingsGroupBooksSection v-else-if="section.key === 'group-read-access'" :group-id="group.id" />
      </div>
    </template>
    <p v-else class="rounded-lg bg-white p-4 text-sm text-gray-600 ring-1 ring-gray-200">{{ s.groupNotFound }}</p>
  </div>
</template>
