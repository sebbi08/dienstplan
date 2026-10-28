<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * On the group's page: its name and the flag „für Schulkinder“. As under Einrichtung → Einrichtungen only the Träger
 * changes them; the Leitung sees them. The order of the groups is changed in the group list.
 */
const props = defineProps<{ groupId: number }>()
const { can } = useCan()
const canManageGroups = computed(() => can('settings.groups'))
const { data: groups, refresh } = useGroups()
// The names appear in the opening hours, the reminders and the automatic leaving too.
const { busy, run } = useBusyAction(() => Promise.all([refresh(), refreshNuxtData(['school-settings', 'opening-hours', 'reminder-settings'])]))
const notifySwitchedOff = useAutoLeaveNotice()

const group = computed(() => groups.value?.find(candidate => candidate.id === props.groupId) ?? null)
const storedName = computed(() => group.value?.name ?? '')
// The draft follows the stored name while it is not edited.
const name = ref(storedName.value)
watch(storedName, (next, previous) => {
  if (name.value.trim() === previous) name.value = next
})
// Spaces around the name do not count as a change (the server trims them).
const dirty = useDirty(() => canManageGroups.value && !!group.value && name.value.trim() !== storedName.value)

async function rename() {
  const current = group.value
  if (!current || !dirty.value || !name.value.trim()) return
  if (await run(() => $fetch<unknown>(`/api/groups/${current.id}`, { method: 'PUT', body: { name: name.value } }), de.common.saved)) name.value = storedName.value
}

/** Flags the group as being for school children or takes the flag away (which switches the facility's automatic leaving off). */
async function setForSchoolChildren(value: boolean) {
  const current = group.value
  if (!current) return
  const answer = { autoLeaveSwitchedOff: false }
  const ok = await run(async () => {
    answer.autoLeaveSwitchedOff = (await $fetch<{ ok: boolean; autoLeaveSwitchedOff: boolean }>(`/api/groups/${current.id}/school-children`, { method: 'PUT', body: { forSchoolChildren: value } })).autoLeaveSwitchedOff
  }, de.common.saved)
  if (ok && answer.autoLeaveSwitchedOff) notifySwitchedOff()
}
</script>

<template>
  <section v-if="group" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settingsAreas.groupName }}</h2>
    <template v-if="canManageGroups">
      <form class="flex flex-wrap items-center gap-2" @submit.prevent="rename">
        <UInput v-model="name" maxlength="80" required size="sm" :aria-label="de.groups.name" />
        <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.groups.rename" :disabled="busy || !dirty || !name.trim()" />
      </form>
      <UCheckbox
        :model-value="group.forSchoolChildren" :label="de.schoolChildren.forSchoolChildren" :disabled="busy"
        @update:model-value="setForSchoolChildren($event === true)"
      />
      <p class="text-xs text-gray-500">{{ de.schoolChildren.forSchoolChildrenHint }}</p>
      <p class="text-xs text-gray-500">{{ de.settingsAreas.groupOrderHint }}</p>
    </template>
    <template v-else>
      <p class="text-sm">{{ group.name }}</p>
      <p v-if="group.forSchoolChildren" class="text-sm">{{ de.schoolChildren.forSchoolChildren }}</p>
      <p class="text-xs text-gray-500">{{ de.settingsAreas.groupNameReadOnly }}</p>
    </template>
  </section>
</template>
