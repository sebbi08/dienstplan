<script setup lang="ts">
import type { GroupDto, StaffingEstimatePreviewDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Gruppe anlegen“ (settings.groups: the Träger) for one facility: the name and, for the facility the settings show,
 * Gruppenart and Plätze with the live Personalschlüssel. Everything else about the group is set on its page
 * (Einstellungen → Gruppen → Gruppe). Emits `created` once the group exists.
 */
const props = defineProps<{ facilityId: number }>()
const emit = defineEmits<{ created: [group: GroupDto] }>()

const { refresh: refreshActive } = useGroups()
// The active facility's groups (rules, templates, employees) follow at once, and the opening hours list the groups too.
const { busy, run } = useBusyAction(() => Promise.all([
  refreshActive(), refreshNuxtData(['school-settings', 'opening-hours', 'staffing-estimate']),
]))
const toast = useToast()

const newName = ref('')
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

useDirty(() => newName.value.trim() !== '' || newType.value !== NONE || capacityText.value !== '')

async function create() {
  if (capacityInvalid.value) return
  const groupType = withEstimate.value ? typeValue.value : null
  const capacity = withEstimate.value ? capacityValue.value : null
  const outcome = { detailsNotSaved: false, group: null as GroupDto | null }
  // Once the group exists the form is cleared and the lists refresh (run's success path), even if Gruppenart or Plätze
  // then fail: those are only reported, so a second click cannot create the group twice.
  await run(async () => {
    const group = await $fetch<GroupDto>(`/api/facilities/${props.facilityId}/groups`, { method: 'POST', body: { name: newName.value } })
    outcome.group = group
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
  if (outcome.group) emit('created', outcome.group)
  if (outcome.detailsNotSaved) toast.add({ title: e.detailsNotSaved, color: 'warning' })
}
</script>

<template>
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
</template>
