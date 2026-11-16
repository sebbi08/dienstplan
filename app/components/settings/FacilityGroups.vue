<script setup lang="ts">
import type { GroupDto, StaffingEstimatePreviewDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Träger only: the groups of one facility, with add, rename and delete (the delete dialog names what goes with it), and
 * per group the other groups its staff may also read at the tablet.
 */
const props = defineProps<{ facilityId: number }>()

// Awaited, so the drafts below are filled before the page is rendered on the server.
const { data: groups, refresh } = await useFetch<GroupDto[]>(() => `/api/facilities/${props.facilityId}/groups`, { default: () => [] })
const { refresh: refreshActive } = useGroups()
// The active facility's groups (rules, templates, employees) follow at once, and the switch of the automatic leaving
// (settings section) follows a flag or a deleted group, and the opening hours list the groups too.
const { busy, run } = useBusyAction(() => Promise.all([
  refresh(), refreshActive(), refreshNuxtData(['school-settings', 'opening-hours', 'staffing-estimate']),
]))
const confirm = useConfirm()
const toast = useToast()
const notifySwitchedOff = useAutoLeaveNotice()

// One draft per group; a refresh keeps drafts with an unsaved edit (as for the facility names).
const names = reactive<Record<number, string>>({})
const stored = reactive(new Map<number, string>())
function syncNames(saved?: number) {
  for (const group of groups.value ?? []) {
    const untouched = names[group.id] === undefined || names[group.id] === stored.get(group.id)
    if (untouched || group.id === saved) names[group.id] = group.name
    stored.set(group.id, group.name)
  }
}
watch(groups, () => syncNames(), { immediate: true })
const newName = ref('')
// Spaces around the name do not count as a change (the server trims them); only a changed, non-empty name can be saved.
const nameChanged = (id: number) => {
  const name = names[id]
  return name !== undefined && name.trim() !== stored.get(id)
}
const nameDirty = (id: number) => nameChanged(id) && (names[id] ?? '').trim() !== ''

// Gruppenart and Plätze of a new group, with the live Personalschlüssel: only for the facility the settings show, whose
// group types and opening hours the server answers with (the other facilities' new groups get them on their page).
const NONE = 'none'
const e = de.staffing.estimate
const settingsFacilityId = useSettingsFacilityId()
const withEstimate = computed(() => settingsFacilityId.value === props.facilityId)
const { data: staffingSettings } = useStaffingSettings()
const types = computed(() => (withEstimate.value ? staffingSettings.value?.effective.groupTypes ?? [] : []))
const typeItems = computed(() => [{ label: de.staffing.groupTypeNone, value: NONE }, ...types.value.map(type => ({ label: type.label, value: type.key }))])
const newType = ref(NONE)
const newCapacity = ref('')
const capacityText = computed(() => String(newCapacity.value ?? '').trim())
const capacityValue = computed(() => {
  const value = Number(capacityText.value)
  return capacityText.value !== '' && Number.isInteger(value) && value >= 1 && value <= 200 ? value : null
})
const capacityInvalid = computed(() => withEstimate.value && capacityText.value !== '' && capacityValue.value === null)
const typeValue = computed(() => (newType.value === NONE ? null : newType.value))
const previewReady = computed(() => withEstimate.value && capacityValue.value !== null && (types.value.length === 0 || typeValue.value !== null))
const preview = ref<StaffingEstimatePreviewDto | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewTicket = 0
// Debounced while typing; a late answer for older values is dropped.
watch([previewReady, typeValue, capacityValue], () => {
  clearTimeout(previewTimer)
  const ticket = ++previewTicket
  if (!previewReady.value) {
    preview.value = null
    return
  }
  previewTimer = setTimeout(async () => {
    try {
      const query = { groupType: typeValue.value ?? undefined, capacity: capacityValue.value ?? undefined }
      const answer = await $fetch<StaffingEstimatePreviewDto>('/api/staffing/estimate/preview', { query })
      if (ticket === previewTicket) preview.value = answer
    }
    catch {
      if (ticket === previewTicket) preview.value = null
    }
  }, 300)
})
onBeforeUnmount(() => clearTimeout(previewTimer))

useDirty(() => newName.value.trim() !== '' || newType.value !== NONE || capacityText.value !== ''
  || (groups.value ?? []).some(group => nameChanged(group.id)))

async function rename(id: number) {
  if (!nameDirty(id)) return
  if (await run(() => $fetch<unknown>(`/api/groups/${id}`, { method: 'PUT', body: { name: names[id] } }), de.common.saved)) syncNames(id)
}

async function create() {
  if (capacityInvalid.value) return
  const groupType = withEstimate.value ? typeValue.value : null
  const capacity = withEstimate.value ? capacityValue.value : null
  const outcome = { detailsNotSaved: false }
  // Once the group exists the form is cleared and the lists refresh (run's success path), even if Gruppenart or Plätze
  // then fail: those are only reported, so a second click cannot create the group twice.
  await run(async () => {
    const group = await $fetch<GroupDto>(`/api/facilities/${props.facilityId}/groups`, { method: 'POST', body: { name: newName.value } })
    newName.value = ''
    newType.value = NONE
    newCapacity.value = ''
    try {
      if (groupType !== null) await $fetch<unknown>(`/api/groups/${group.id}/group-type`, { method: 'PUT', body: { groupType } })
      if (capacity !== null) await $fetch<unknown>(`/api/groups/${group.id}/capacity`, { method: 'PUT', body: { capacity } })
    }
    catch {
      outcome.detailsNotSaved = true
    }
  }, de.common.saved)
  if (outcome.detailsNotSaved) toast.add({ title: e.detailsNotSaved, color: 'warning' })
}

async function remove(group: GroupDto) {
  if (!await confirm(de.groups.deleteConfirm(group.name))) return
  const answer = { autoLeaveSwitchedOff: false }
  const ok = await run(async () => {
    answer.autoLeaveSwitchedOff = (await $fetch<{ ok: boolean; autoLeaveSwitchedOff: boolean }>(`/api/groups/${group.id}`, { method: 'DELETE' })).autoLeaveSwitchedOff
  }, de.common.deleted)
  if (ok && answer.autoLeaveSwitchedOff) notifySwitchedOff()
}

/** Flags the group as being for school children or takes the flag away (which switches the facility's automatic leaving off). */
async function setForSchoolChildren(group: GroupDto, value: boolean) {
  const answer = { autoLeaveSwitchedOff: false }
  const ok = await run(async () => {
    answer.autoLeaveSwitchedOff = (await $fetch<{ ok: boolean; autoLeaveSwitchedOff: boolean }>(`/api/groups/${group.id}/school-children`, { method: 'PUT', body: { forSchoolChildren: value } })).autoLeaveSwitchedOff
  }, de.common.saved)
  if (ok && answer.autoLeaveSwitchedOff) notifySwitchedOff()
}
</script>

<template>
  <div class="space-y-2 border-l-2 border-gray-100 pl-3">
    <h3 class="text-sm font-semibold text-gray-700">{{ de.groups.title }}</h3>
    <p v-if="!groups?.length" class="text-xs text-gray-500">{{ de.groups.none }}</p>
    <form v-for="group in groups ?? []" :key="group.id" class="flex flex-wrap items-center gap-2" @submit.prevent="rename(group.id)">
      <UInput v-model="names[group.id]" maxlength="80" required size="sm" :aria-label="de.groups.name" />
      <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.groups.rename" :disabled="busy || !nameDirty(group.id)" />
      <UCheckbox
        :model-value="group.forSchoolChildren" :label="de.schoolChildren.forSchoolChildren" :aria-label="`${de.schoolChildren.forSchoolChildren}: ${group.name}`" :disabled="busy"
        @update:model-value="setForSchoolChildren(group, $event === true)"
      />
      <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(group)" />
    </form>
    <p v-if="groups?.length" class="text-xs text-gray-500">{{ de.schoolChildren.forSchoolChildrenHint }}</p>
    <SettingsGroupReadAccess v-if="(groups?.length ?? 0) > 1" :groups="groups ?? []" :source="`/api/facilities/${facilityId}/group-read-access`" />
    <form class="space-y-2" @submit.prevent="create">
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="newName" maxlength="80" required size="sm" :placeholder="de.groups.name" :aria-label="de.groups.name" />
        <template v-if="withEstimate">
          <USelect v-if="types.length" v-model="newType" :items="typeItems" size="sm" class="w-full max-w-64" :aria-label="de.staffing.groupType" />
          <UInput
            v-model="newCapacity" type="number" min="1" max="200" step="1" size="sm" class="w-24"
            :placeholder="e.newCapacity" :aria-label="e.newCapacity" :color="capacityInvalid ? 'error' : 'primary'" :highlight="capacityInvalid"
          />
        </template>
        <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.groups.add" :disabled="busy || !newName.trim() || capacityInvalid" />
      </div>
      <p v-if="withEstimate" class="text-xs text-gray-500">{{ e.previewHint }}</p>
      <div v-if="preview" class="space-y-1 rounded-md bg-gray-50 p-3 ring-1 ring-gray-200">
        <p class="text-xs font-semibold text-gray-700">{{ e.preview }}</p>
        <SettingsStaffingEstimate :estimate="preview.group" :land="preview.land" :fte-hours-per-week="preview.fteHoursPerWeek" />
      </div>
    </form>
  </div>
</template>
