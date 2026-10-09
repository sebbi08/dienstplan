<script setup lang="ts">
import type { DocumentTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Document types (Dokumentarten) of the facility: which ones are important, which are needed for every child, and the default visibility. */
interface Form { id: number | null; name: string; important: boolean; required: boolean; confidentialDefault: boolean; sortOrder: number }

const { data, refresh } = await useFetch<DocumentTypeDto[]>('/api/document-types', { key: 'settings-document-types' })
// The child pages offer the same list; keep them in step.
const run = useAction(async () => {
  await Promise.all([refresh(), refreshNuxtData(['document-types', 'child-documents-overview'])])
})
const confirm = useConfirm()
// One request at a time: no double submit.
const busy = ref(false)

const emptyForm = (): Form => ({ id: null, name: '', important: false, required: false, confidentialDefault: false, sortOrder: 0 })
const forms = ref<Form[]>([])
const newForm = ref<Form>(emptyForm())
watch(data, (value) => {
  forms.value = (value ?? []).map(type => ({ ...type }))
}, { immediate: true })

/** A type needed for every child is important by definition (the server refuses the other combination). */
function onRequired(form: Form, value: boolean) {
  form.required = value
  if (value) form.important = true
}
function onImportant(form: Form, value: boolean) {
  form.important = value
  if (!value) form.required = false
}

async function guarded(action: () => Promise<boolean>): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    return await action()
  }
  finally {
    busy.value = false
  }
}

function save(form: Form) {
  const body = { name: form.name, important: form.important, required: form.required, confidentialDefault: form.confidentialDefault, sortOrder: form.sortOrder }
  return guarded(async () => {
    const ok = await run(() => form.id
      ? $fetch<unknown>(`/api/document-types/${form.id}`, { method: 'PUT', body })
      : $fetch<unknown>('/api/document-types', { method: 'POST', body }), de.common.saved)
    if (ok && !form.id) newForm.value = emptyForm()
    return ok
  })
}

async function remove(form: Form) {
  if (form.id && await confirm(de.childSettings.confirmDeleteType)) guarded(() => run(() => $fetch<unknown>(`/api/document-types/${form.id}`, { method: 'DELETE' }), de.common.deleted))
}

const cell = 'px-1 py-1'
const textInput = 'w-full rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.childSettings.documentTypes }}</h2>
    <p class="text-xs text-gray-500">{{ de.childSettings.documentTypesHint }}</p>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.childSettings.important }}</th>
            <th :class="cell">{{ de.childSettings.required }}</th><th :class="cell">{{ de.childSettings.confidentialDefault }}</th>
            <th :class="cell">{{ de.settings.sortOrder }}</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in [...forms, newForm]" :key="form.id ?? 'new'" class="border-t border-gray-100">
            <td :class="cell"><input v-model="form.name" maxlength="80" :class="textInput" :aria-label="de.settings.label"></td>
            <td :class="cell" class="text-center"><input :checked="form.important" type="checkbox" :aria-label="de.childSettings.important" @change="onImportant(form, ($event.target as HTMLInputElement).checked)"></td>
            <td :class="cell" class="text-center"><input :checked="form.required" type="checkbox" :aria-label="de.childSettings.required" @change="onRequired(form, ($event.target as HTMLInputElement).checked)"></td>
            <td :class="cell" class="text-center"><input v-model="form.confidentialDefault" type="checkbox" :aria-label="de.childSettings.confidentialDefault"></td>
            <td :class="cell"><input v-model.number="form.sortOrder" type="number" min="0" max="10000" class="w-16 rounded border border-gray-300 px-1 py-0.5" :aria-label="de.settings.sortOrder" :disabled="!form.id"></td>
            <td :class="cell" class="whitespace-nowrap text-right">
              <UButton size="xs" :label="form.id ? de.common.save : de.common.add" :disabled="busy" @click="save(form)" />
              <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(form)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
