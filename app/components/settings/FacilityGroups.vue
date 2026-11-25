<script setup lang="ts">
import type { GroupDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { groupPath } from '~/utils/settingsAreas'

/**
 * Träger only, in a facility's card: the facility's groups as a compact list, each opening the group's page (name,
 * Gruppenart, Plätze, Schulkinder, Lesen, Öffnungszeiten … and „Gruppe löschen“ – everything about a group is edited
 * there, in one place), and „Gruppe anlegen“. A group of another facility than the one the settings show switches
 * „Einstellungen für“ to that facility first.
 */
const props = defineProps<{ facilityId: number }>()
/** How many groups the facility has (for its card's header). */
const emit = defineEmits<{ count: [count: number] }>()

const { data: groups, refresh } = await useFetch<GroupDto[]>(() => `/api/facilities/${props.facilityId}/groups`, { default: () => [] })
watch(() => groups.value?.length ?? 0, count => emit('count', count), { immediate: true })
const s = de.settingsAreas

const { data: facilities } = useFacilities()
const chosenFacility = useSettingsFacility()
const shownFacility = useSettingsFacilityId()
const confirm = useConfirm()

/** Opens the group's page; for another facility than the shown one, its settings are chosen first. */
async function openGroup(group: GroupDto) {
  if (shownFacility.value !== props.facilityId) {
    if (hasUnsavedChanges() && !await confirm(s.unsavedConfirm, { confirmLabel: s.unsavedSwitch, danger: true })) return
    chosenFacility.value = props.facilityId === facilities.value?.activeId ? null : props.facilityId
    await refreshNuxtData()
  }
  await navigateTo(groupPath(group.id))
}
</script>

<template>
  <div class="space-y-2 border-l-2 border-gray-100 pl-3">
    <h3 class="text-sm font-semibold text-gray-700">{{ de.groups.title }}</h3>
    <p v-if="!groups?.length" class="text-xs text-gray-500">{{ de.groups.none }}</p>
    <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
      <li v-for="group in groups" :key="group.id">
        <button
          type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
          :aria-label="s.openGroupSettings(group.name)" @click="openGroup(group)"
        >
          <span class="min-w-0 flex-1 truncate font-medium">{{ group.name }}</span>
          <span v-if="group.forSchoolChildren" class="shrink-0 text-xs text-gray-500">{{ de.schoolChildren.forSchoolChildren }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <p v-if="groups?.length" class="text-xs text-gray-500">{{ s.groupsEditOnPage }}</p>
    <SettingsGroupCreateForm :facility-id="facilityId" @created="refresh()" />
  </div>
</template>
