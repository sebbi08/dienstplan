<script setup lang="ts">
import { areaOfSlug, sectionAnchor, visibleSettingsAreas } from '~/utils/settingsAreas'

/** One area of the settings (/admin/settings/<area>) with its sections; an unknown area or one the role may not see leads to the overview. */
const route = useRoute()
const { user } = useUserSession()
const entry = computed(() => {
  const area = areaOfSlug(route.params.area)
  return visibleSettingsAreas({ isProvider: user.value?.role === 'provider' }).find(candidate => candidate.area === area) ?? null
})
if (!entry.value) await navigateTo('/admin/settings', { replace: true })

// The search leads here with a section's anchor: scroll to it once it is rendered and mark it for a moment.
const target = ref('')
async function scrollToTarget() {
  const id = route.hash.slice(1)
  if (!id) return
  target.value = id
  await nextTick()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  setTimeout(() => {
    if (target.value === id) target.value = ''
  }, 2000)
}
onMounted(scrollToTarget)
watch(() => route.hash, scrollToTarget)
</script>

<template>
  <div v-if="entry" class="space-y-4">
    <h2 class="text-xl font-semibold">{{ entry.title }}</h2>
    <div
      v-for="section in entry.sections" :id="sectionAnchor(section.key)" :key="section.key"
      class="scroll-mt-20 rounded-lg transition-shadow empty:hidden" :class="target === sectionAnchor(section.key) ? 'ring-2 ring-sky-400' : ''"
    >
      <SettingsFacilitiesSection v-if="section.key === 'facilities'" />
      <SettingsOpeningHoursSection v-else-if="section.key === 'facility-hours'" />
      <SettingsTabletSection v-else-if="section.key === 'tablet'" />
      <SettingsChildRetentionSection v-else-if="section.key === 'retention'" />
      <SettingsBackupSection v-else-if="section.key === 'backup'" />
      <SettingsGroupListSection v-else-if="section.key === 'group-list'" />
      <SettingsShiftTemplatesSection v-else-if="section.key === 'shift-templates'" />
      <WeekTemplatesSection v-else-if="section.key === 'week-templates'" />
      <SettingsCodesSection v-else-if="section.key === 'codes'" />
      <SettingsCoverageRulesSection v-else-if="section.key === 'coverage-rules'" />
      <SettingsRequirementTypesSection v-else-if="section.key === 'requirement-types'" />
      <SettingsLeaveModuleSection v-else-if="section.key === 'leave-module'" />
      <SettingsLeaveCountingSection v-else-if="section.key === 'leave-counting'" />
      <SettingsTimeTrackingSection v-else-if="section.key === 'time-tracking'" />
      <SettingsCareTypesSection v-else-if="section.key === 'care-types'" />
      <SettingsDocumentTypesSection v-else-if="section.key === 'document-types'" />
      <SettingsSchoolChildrenSection v-else-if="section.key === 'school-children'" />
      <SettingsAttendanceSection v-else-if="section.key === 'attendance'" />
      <SettingsRemindersSection v-else-if="section.key === 'reminders'" />
      <SettingsStaffingSection v-else-if="section.key === 'staffing'" />
      <SettingsEmployeeRetentionSection v-else-if="section.key === 'employee-retention'" />
    </div>
  </div>
</template>
