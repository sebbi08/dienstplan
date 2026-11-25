<script setup lang="ts">
import { de } from '~/locales/de'
import { areaOfSlug, sectionAnchor, visibleSettingsAreas } from '~/utils/settingsAreas'

/** One area of the settings (/admin/settings/<area>) with its sections; an unknown area or one the role may not see leads to the overview. */
const route = useRoute()
const { can } = useCan()
const entry = computed(() => {
  const area = areaOfSlug(route.params.area)
  return visibleSettingsAreas({ can }).find(candidate => candidate.area === area) ?? null
})
if (!entry.value) await navigateTo('/admin/settings', { replace: true })

// Area Einrichtung: the facility cards first, then the sections for the facility chosen in „Einstellungen für“ under a
// heading that names it (the first section after the cards).
const { data: facilities } = useFacilities()
const chosenId = useSettingsFacilityId()
const chosenName = computed(() => facilities.value?.facilities.find(facility => facility.id === chosenId.value)?.name ?? null)
const settingsForBefore = computed(() => {
  const sections = entry.value?.area === 'facility' ? entry.value.sections : []
  const cards = sections.findIndex(section => section.key === 'facilities')
  return cards === -1 ? null : sections[cards + 1]?.key ?? null
})

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
    <template v-for="section in entry.sections" :key="section.key">
      <h2 v-if="section.key === settingsForBefore && chosenName" class="border-t border-gray-200 pt-4 text-lg font-semibold">
        {{ de.settingsAreas.settingsForChosen(chosenName) }}
      </h2>
      <div
        :id="sectionAnchor(section.key)"
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
        <SettingsLeaveForfeitSection v-else-if="section.key === 'leave-forfeit'" />
        <SettingsTimeTrackingSection v-else-if="section.key === 'time-tracking'" />
        <SettingsCareTypesSection v-else-if="section.key === 'care-types'" />
        <SettingsDocumentTypesSection v-else-if="section.key === 'document-types'" />
        <SettingsConsentQuestionsSection v-else-if="section.key === 'consent-questions'" />
        <SettingsOverviewSheetsSection v-else-if="section.key === 'overview-sheets'" />
        <SettingsSchoolChildrenSection v-else-if="section.key === 'school-children'" />
        <SettingsSchoolDistrictsSection v-else-if="section.key === 'school-districts'" />
        <SettingsAttendanceSection v-else-if="section.key === 'attendance'" />
        <SettingsIfsgSection v-else-if="section.key === 'ifsg'" />
        <SettingsIfsgLocalSection v-else-if="section.key === 'ifsg-local'" />
        <SettingsRemindersSection v-else-if="section.key === 'reminders'" />
        <SettingsStaffingSection v-else-if="section.key === 'staffing'" />
        <SettingsRequiredDocumentsSection v-else-if="section.key === 'required-documents'" />
        <SettingsEmployeeRetentionSection v-else-if="section.key === 'employee-retention'" />
        <SettingsChildSickSection v-else-if="section.key === 'child-sick-days'" />
        <SettingsBemInvitationSection v-else-if="section.key === 'bem-invitation'" />
        <SettingsParentalLeaveSection v-else-if="section.key === 'parental-leave'" />
      </div>
    </template>
  </div>
</template>
