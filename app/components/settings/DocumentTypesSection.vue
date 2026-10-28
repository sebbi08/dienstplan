<script setup lang="ts">
import type { DocumentTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Document types (Dokumentarten) of the facility: which ones are important, which are needed for every child, and the default visibility. */
interface Form { id: number | null; name: string; important: boolean; required: boolean; confidentialDefault: boolean; careContract: boolean }

const s = de.schoolChildren
const { forms, newForm, busy, save, remove, isDirty } = await useTypeList<DocumentTypeDto, Form>({
  url: '/api/document-types',
  key: 'settings-document-types',
  // The child pages offer the same list; keep them in step.
  refreshKeys: ['document-types', 'child-documents-overview'],
  empty: () => ({ id: null, name: '', important: false, required: false, confidentialDefault: false, careContract: false }),
  toForm: ({ sortOrder: _ignored, ...type }) => type,
  toBody: form => ({ name: form.name, important: form.important, required: form.required, confidentialDefault: form.confidentialDefault, careContract: form.careContract }),
})

/** A type needed for every child is important by definition (the server refuses the other combination). */
function onRequired(form: Form, value: boolean) {
  form.required = value
  if (value) form.important = true
}
function onImportant(form: Form, value: boolean) {
  form.important = value
  if (!value) form.required = false
}

const cell = 'px-1 py-1'
const textInput = 'w-full rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.childSettings.documentTypes }}</h2>
    <p class="text-xs text-gray-500">{{ de.childSettings.documentTypesHint }}</p>
    <p class="text-xs text-gray-500">{{ s.careContractHint }}</p>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.childSettings.important }}</th>
            <th :class="cell">{{ de.childSettings.required }}</th><th :class="cell">{{ de.childSettings.confidentialDefault }}</th>
            <th :class="cell">{{ s.careContract }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in [...forms, newForm]" :key="form.id ?? 'new'" class="border-t border-gray-100">
            <td :class="cell"><input v-model="form.name" maxlength="80" :class="textInput" :aria-label="de.settings.label"></td>
            <td :class="cell" class="text-center"><input :checked="form.important" type="checkbox" :aria-label="de.childSettings.important" @change="onImportant(form, ($event.target as HTMLInputElement).checked)"></td>
            <td :class="cell" class="text-center"><input :checked="form.required" type="checkbox" :aria-label="de.childSettings.required" @change="onRequired(form, ($event.target as HTMLInputElement).checked)"></td>
            <td :class="cell" class="text-center"><input v-model="form.confidentialDefault" type="checkbox" :aria-label="de.childSettings.confidentialDefault"></td>
            <td :class="cell" class="text-center"><input v-model="form.careContract" type="checkbox" :aria-label="s.careContract"></td>
            <td :class="cell" class="whitespace-nowrap text-right">
              <UButton v-if="!form.id" size="xs" :label="de.common.add" :disabled="busy || !isDirty(form)" @click="save(form)" />
              <UButton v-else-if="isDirty(form)" size="xs" :label="de.common.save" :disabled="busy" @click="save(form)" />
              <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(form)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
