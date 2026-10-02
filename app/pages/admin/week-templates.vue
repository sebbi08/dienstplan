<script setup lang="ts">
import type { WeekTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

/** Saved plan weeks: preview, rename and delete (saving and inserting happen in the plan's week rows). */
const { data: templates, refresh } = await useFetch<WeekTemplateDto[]>('/api/week-templates')
const run = useAction(refresh)
const confirm = useConfirm()
const renaming = reactive<{ id: number | null; name: string }>({ id: null, name: '' })

function startRename(template: WeekTemplateDto) {
  Object.assign(renaming, { id: template.id, name: template.name })
}

async function saveRename() {
  const id = renaming.id
  if (id === null || !renaming.name.trim()) return
  const ok = await run(() => $fetch<unknown>(`/api/week-templates/${id}`, { method: 'PUT', body: { name: renaming.name } }), de.common.saved)
  if (ok) renaming.id = null
}

async function remove(template: WeekTemplateDto) {
  if (!await confirm(de.weekTemplates.deleteConfirm(template.name))) return
  run(() => $fetch<unknown>(`/api/week-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
}
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.weekTemplates.title }}</h1>
    <p class="text-sm text-gray-500">{{ de.weekTemplates.hint }}</p>
    <p v-if="!templates?.length" class="text-sm text-gray-500">{{ de.weekTemplates.none }}</p>
    <section
      v-for="template in templates" :key="template.id"
      class="space-y-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200"
    >
      <div class="flex flex-wrap items-center gap-2">
        <form v-if="renaming.id === template.id" class="flex flex-wrap items-center gap-2" @submit.prevent="saveRename">
          <UInput v-model="renaming.name" maxlength="100" autofocus required />
          <UButton type="submit" size="sm" :label="de.common.save" />
          <UButton size="sm" color="neutral" variant="ghost" :label="de.common.cancel" @click="renaming.id = null" />
        </form>
        <h2 v-else class="text-lg font-semibold">{{ template.name }}</h2>
        <span class="text-xs text-gray-500">{{ de.weekTemplates.updated }} {{ formatDateTime(template.updatedAt) }}</span>
        <div class="ml-auto flex gap-1">
          <UButton
            v-if="renaming.id !== template.id" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil"
            :label="de.weekTemplates.rename" @click="startRename(template)"
          />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" @click="remove(template)" />
        </div>
      </div>
      <WeekTemplatePreview :template="template" />
    </section>
  </div>
</template>
