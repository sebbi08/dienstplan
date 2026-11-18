<script setup lang="ts">
import type { WeekTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'
import { areaPath } from '~/utils/settingsAreas'

/**
 * Settings section of the week templates: preview, create and edit (own page), rename and delete (saving a plan week
 * and inserting a template happen in the plan's week rows).
 */
const editorPath = (id: number | 'new') => `${areaPath('roster')}/week-templates/${id}`
const { data: templates, refresh } = await useFetch<WeekTemplateDto[]>('/api/week-templates')
const run = useAction(refresh)
const confirm = useConfirm()
const renaming = reactive<{ id: number | null; name: string }>({ id: null, name: '' })
// With groups, each template says whom it is for.
const { data: groups, hasGroups } = useGroups()
function scopeText(template: WeekTemplateDto): string {
  const group = groups.value?.find(candidate => candidate.id === template.groupId)
  return group ? de.weekTemplates.forGroup(group.name) : de.weekTemplates.forGroup(de.weekTemplates.wholeFacility)
}

// Only a changed, non-empty name can be saved.
const renameDirty = (template: WeekTemplateDto) => renaming.id === template.id && renaming.name.trim() !== '' && renaming.name !== template.name
useDirty(() => templates.value?.some(template => renaming.id === template.id && renaming.name !== template.name) ?? false)

function startRename(template: WeekTemplateDto) {
  Object.assign(renaming, { id: template.id, name: template.name })
}

async function saveRename() {
  const id = renaming.id
  const template = templates.value?.find(candidate => candidate.id === id)
  if (id === null || !template || !renameDirty(template)) return
  const ok = await run(() => $fetch<unknown>(`/api/week-templates/${id}`, { method: 'PUT', body: { name: renaming.name } }), de.common.saved)
  if (ok) renaming.id = null
}

async function remove(template: WeekTemplateDto) {
  if (!await confirm(de.weekTemplates.deleteConfirm(template.name))) return
  run(() => $fetch<unknown>(`/api/week-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ de.weekTemplates.title }}</h2>
      <UButton size="sm" icon="i-lucide-plus" class="ml-auto" :label="de.weekTemplates.create" :to="editorPath('new')" />
    </div>
    <p class="text-xs text-gray-500">{{ de.weekTemplates.hint }}</p>
    <p v-if="!templates?.length" class="text-sm text-gray-500">{{ de.weekTemplates.none }}</p>
    <div
      v-for="template in templates" :key="template.id"
      class="space-y-3 rounded-md p-3 ring-1 ring-gray-200"
    >
      <div class="flex flex-wrap items-center gap-2">
        <form v-if="renaming.id === template.id" class="flex flex-wrap items-center gap-2" @submit.prevent="saveRename">
          <UInput v-model="renaming.name" maxlength="100" autofocus required />
          <UButton type="submit" size="sm" :label="de.common.save" :disabled="!renameDirty(template)" />
          <UButton size="sm" color="neutral" variant="ghost" :label="de.common.cancel" @click="renaming.id = null" />
        </form>
        <h3 v-else class="font-semibold">{{ template.name }}</h3>
        <UBadge v-if="hasGroups" color="neutral" variant="soft" :label="scopeText(template)" />
        <span class="text-xs text-gray-500">{{ de.weekTemplates.updated }} {{ formatDateTime(template.updatedAt) }}</span>
        <div class="ml-auto flex flex-wrap gap-1">
          <UButton
            size="xs" color="neutral" variant="ghost" icon="i-lucide-table-2" :label="de.weekTemplates.edit"
            :to="editorPath(template.id)"
          />
          <UButton
            v-if="renaming.id !== template.id" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil"
            :label="de.weekTemplates.rename" @click="startRename(template)"
          />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" @click="remove(template)" />
        </div>
      </div>
      <WeekTemplatePreview :template="template" />
    </div>
  </section>
</template>
