<script setup lang="ts">
import type { SettingsDto, WeekTemplateCoverageDto, WeekTemplateDetailDto, WeekTemplateStaffDto } from '#shared/types/api'
import WeekTemplateEditor from '~/components/week-templates/WeekTemplateEditor.vue'
import { de } from '~/locales/de'
import { areaPath, sectionAnchor } from '~/utils/settingsAreas'

/**
 * The editor of one week template (/admin/settings/roster/week-templates/<id>, „new“ for a new one), inside the
 * settings frame, whose guard asks before unsaved edits are left. An unknown id shows the error page.
 */
const route = useRoute()
const isNew = route.params.id === 'new'
const id = Number(route.params.id)
if (!isNew && !(Number.isInteger(id) && id > 0)) throw createError({ statusCode: 404, statusMessage: de.errors.week_template_not_found, fatal: true })
const back = `${areaPath('roster')}#${sectionAnchor('week-templates')}`

const { data: staff } = await useFetch<WeekTemplateStaffDto[]>('/api/week-templates/staff')
// Pflichtdienste and opening hours for the editor's coverage warnings; without them the editor just shows none.
const { data: coverage } = await useFetch<WeekTemplateCoverageDto>('/api/week-templates/coverage')
const { data: settings } = await useFetch<SettingsDto>('/api/settings', { key: 'settings' })
const { data: groups } = await useGroups()
const templateFetch = isNew ? null : await useFetch<WeekTemplateDetailDto>(`/api/week-templates/${id}`)
if (templateFetch?.error.value) {
  throw createError({ statusCode: templateFetch.error.value.statusCode ?? 500, statusMessage: de.errors.week_template_not_found, fatal: true })
}
const template = computed(() => templateFetch?.data.value ?? null)
</script>

<template>
  <div class="space-y-4">
    <NuxtLink :to="back" class="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
      <UIcon name="i-lucide-chevron-left" class="size-4" aria-hidden="true" /> {{ de.weekTemplates.editor.back }}
    </NuxtLink>
    <WeekTemplateEditor
      v-if="staff && settings && (isNew || template)"
      :template="template" :staff="staff" :templates="settings.templates" :codes="settings.codes" :groups="groups ?? []"
      :coverage="coverage ?? null" @done="navigateTo(back)"
    />
  </div>
</template>
