<script setup lang="ts">
import { de } from '~/locales/de'
import { areaPath } from '~/utils/settingsAreas'

/**
 * On the group's page: its name, the flag „für Schulkinder“ and „Gruppe löschen“ – the only place where a group is
 * renamed or deleted (Träger, settings.groups; the Leitung sees name and flag). The order of the groups is changed in
 * the group list; new groups are added there or in the facility's card.
 */
const props = defineProps<{ groupId: number }>()
const { can } = useCan()
const canManageGroups = computed(() => can('settings.groups'))
// The flag „für Schulkinder“ is a school children setting (children.schoolSettings, as its route checks).
const canSetSchoolChildren = computed(() => can('children.schoolSettings'))
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

const confirm = useConfirm()
/** Deletes the group (asking first, naming what goes with it) and goes back to the group list. */
async function remove() {
  const current = group.value
  if (!current || !await confirm(de.groups.deleteConfirm(current.name))) return
  const answer = { autoLeaveSwitchedOff: false }
  const ok = await run(async () => {
    answer.autoLeaveSwitchedOff = (await $fetch<{ ok: boolean; autoLeaveSwitchedOff: boolean }>(`/api/groups/${current.id}`, { method: 'DELETE' })).autoLeaveSwitchedOff
  }, de.common.deleted)
  if (!ok) return
  if (answer.autoLeaveSwitchedOff) notifySwitchedOff()
  await navigateTo(areaPath('groups'))
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
      <template v-if="canSetSchoolChildren">
        <UCheckbox
          :model-value="group.forSchoolChildren" :label="de.schoolChildren.forSchoolChildren" :disabled="busy"
          @update:model-value="setForSchoolChildren($event === true)"
        />
        <p class="text-xs text-gray-500">{{ de.schoolChildren.forSchoolChildrenHint }}</p>
      </template>
      <p v-else-if="group.forSchoolChildren" class="text-sm">{{ de.schoolChildren.forSchoolChildren }}</p>
      <p class="text-xs text-gray-500">{{ de.settingsAreas.groupOrderHint }}</p>
      <div class="border-t border-gray-100 pt-2">
        <UButton size="sm" color="error" variant="outline" icon="i-lucide-trash-2" :label="de.settingsAreas.groupDelete" :disabled="busy" @click="remove" />
      </div>
    </template>
    <template v-else>
      <p class="text-sm">{{ group.name }}</p>
      <p v-if="group.forSchoolChildren" class="text-sm">{{ de.schoolChildren.forSchoolChildren }}</p>
      <p class="text-xs text-gray-500">{{ de.settingsAreas.groupNameReadOnly }}</p>
    </template>
  </section>
</template>
