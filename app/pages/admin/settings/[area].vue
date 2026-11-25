<script setup lang="ts">
import { de } from '~/locales/de'
import {
  areaOfSlug, JUMP_LINKS_FROM, MOVED_SECTIONS, readOnlyForViewer, sectionAnchor, visibleSettingsAreas,
} from '~/utils/settingsAreas'

/**
 * One area of the settings (/admin/settings/<area>) with its sections; an unknown area or one the role may not see
 * leads to the overview. A long area starts with jump links to its sections; a section that is the same for all
 * facilities is marked so; a section that lives on another page is a link card; the sections only the Träger changes
 * are folded into one line at the end for whoever only reads them (the Leitung).
 */
const route = useRoute()
const { can } = useCan()
const entry = computed(() => {
  const area = areaOfSlug(route.params.area)
  return visibleSettingsAreas({ can }).find(candidate => candidate.area === area) ?? null
})
if (!entry.value) await navigateTo('/admin/settings', { replace: true })
const viewer = { can }
const editable = computed(() => (entry.value?.sections ?? []).filter(section => !readOnlyForViewer(section, viewer)))
const readOnly = computed(() => (entry.value?.sections ?? []).filter(section => readOnlyForViewer(section, viewer)))
const jumpLinks = computed(() => (editable.value.length >= JUMP_LINKS_FROM ? editable.value : []))
const s = de.settingsAreas

// Area Einrichtung: the facility cards first, then the sections for the facility chosen in „Einstellungen für“ under a
// heading that names it (the first section after the cards).
const { data: facilities } = useFacilities()
const chosenId = useSettingsFacilityId()
const chosenName = computed(() => facilities.value?.facilities.find(facility => facility.id === chosenId.value)?.name ?? null)
const settingsForBefore = computed(() => {
  const sections = entry.value?.area === 'facility' ? editable.value : []
  const cards = sections.findIndex(section => section.key === 'facilities')
  return cards === -1 ? null : sections[cards + 1]?.key ?? null
})

// The search leads here with a section's anchor: scroll to it once it is rendered and mark it for a moment.
const target = ref('')
const foldOpen = ref(false)
async function scrollToTarget() {
  const id = route.hash.slice(1)
  if (!id) return
  // A section that moved to another page (Löschfristen, Datensicherung): old links lead there.
  const moved = MOVED_SECTIONS[id]
  if (moved) return void navigateTo(moved, { replace: true })
  // A folded section of the Träger opens its fold.
  if (readOnly.value.some(section => sectionAnchor(section.key) === id)) foldOpen.value = true
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
    <nav v-if="jumpLinks.length" :aria-label="s.jumpLinks" class="flex flex-wrap gap-1.5">
      <NuxtLink
        v-for="section in jumpLinks" :key="section.key" :to="{ hash: `#${sectionAnchor(section.key)}` }"
        class="rounded-full bg-white px-3 py-1 text-xs text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
      >
        {{ section.title }}
      </NuxtLink>
    </nav>
    <template v-for="section in editable" :key="section.key">
      <h2 v-if="section.key === settingsForBefore && chosenName" class="border-t border-gray-200 pt-4 text-lg font-semibold">
        {{ de.settingsAreas.settingsForChosen(chosenName) }}
      </h2>
      <div
        :id="sectionAnchor(section.key)"
        class="scroll-mt-20 rounded-lg transition-shadow empty:hidden" :class="target === sectionAnchor(section.key) ? 'ring-2 ring-sky-400' : ''"
      >
        <SettingsGlobalBadge v-if="section.global" class="mb-1" />
        <SettingsLinkCard v-if="section.to" :title="section.title" :to="section.to" :text="section.key === 'staff-retention' ? de.privacy.staffLinkCard : de.privacy.linkCard" />
        <SettingsFacilitiesSection v-else-if="section.key === 'facilities'" />
        <SettingsOpeningHoursSection v-else-if="section.key === 'facility-hours'" />
        <SettingsTabletSection v-else-if="section.key === 'tablet'" />
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
        <SettingsChildSickSection v-else-if="section.key === 'child-sick-days'" />
        <SettingsBemInvitationSection v-else-if="section.key === 'bem-invitation'" />
        <SettingsParentalLeaveSection v-else-if="section.key === 'parental-leave'" />
      </div>
    </template>
    <!-- The Träger's sections the viewer only reads: one line, opened on demand. -->
    <details v-if="readOnly.length" class="rounded-lg bg-white ring-1 ring-gray-200" :open="foldOpen" @toggle="foldOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="cursor-pointer px-4 py-3 text-sm text-gray-700">{{ s.traegerSections(readOnly.map(section => section.title)) }}</summary>
      <div class="space-y-4 p-4 pt-0">
        <div v-for="section in readOnly" :id="sectionAnchor(section.key)" :key="section.key" class="scroll-mt-20 empty:hidden">
          <SettingsGlobalBadge v-if="section.global" class="mb-1" />
          <SettingsCodesSection v-if="section.key === 'codes'" />
          <SettingsLeaveCountingSection v-else-if="section.key === 'leave-counting'" />
          <SettingsChildSickSection v-else-if="section.key === 'child-sick-days'" />
        </div>
      </div>
    </details>
  </div>
</template>
