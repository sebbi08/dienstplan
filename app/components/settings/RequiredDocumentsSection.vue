<script setup lang="ts">
import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION, type EmployeeDocumentFolder } from '#shared/domain/personnel'
import { REQUIRED_DOCUMENT_LIMITS } from '#shared/domain/requiredDocuments'
import { QUALIFICATIONS, type Qualification } from '#shared/domain/staffing/types'
import type { PrintTemplateDto, RequiredDocumentTypeDto, RequiredDocumentTypeInput } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Mitarbeitende → Pflichtdokumente (Leitung and Träger): the documents every employee – or those of chosen
 * qualifications – must have in the personnel file, each filed in a folder the editor may use (the list shows only
 * those), optionally valid for some months and filled from a print template. ▲/▼ orders them; deleting keeps the
 * documents.
 */
const t = de.requiredDocuments
const { can } = useCan()
const { data: types, refresh } = await useFetch<RequiredDocumentTypeDto[]>('/api/required-document-types', { key: 'required-document-types', default: () => [] })
const { busy, run } = useBusyAction(refresh)
/** The ▲/▼ show only after „Reihenfolge ändern“. */
const reordering = ref(false)
const confirm = useConfirm()

const folders = computed(() => EMPLOYEE_DOCUMENT_FOLDERS.filter(folder => can(FOLDER_PERMISSION[folder])))
const folderItems = computed(() => folders.value.map(folder => ({ label: de.personnel.folders[folder], value: folder })))
const qualificationItems = QUALIFICATIONS.map(key => ({ label: de.staffing.qualifications[key], value: key }))
const appliesItems = [{ label: t.appliesAll, value: 'all' }, { label: t.appliesChosen, value: 'chosen' }]

// The print templates to fill from (loaded when the dialog opens; without them the choice offers „keine“ only).
const templates = ref<PrintTemplateDto[]>([])
const templateItems = computed(() => [{ label: t.noTemplate, value: 0 }, ...templates.value.map(template => ({ label: template.title, value: template.id }))])

interface Form { name: string; folder: EmployeeDocumentFolder; applies: 'all' | 'chosen'; qualifications: Qualification[]; validity: string; templateId: number; active: boolean }
const editing = ref<RequiredDocumentTypeDto | null>(null)
const open = ref(false)
const form = reactive<Form>({ name: '', folder: 'contract', applies: 'all', qualifications: [], validity: '', templateId: 0, active: true })

async function openDialog(type: RequiredDocumentTypeDto | null) {
  editing.value = type
  Object.assign(form, type
    ? {
        name: type.name, folder: type.folder, applies: type.appliesTo === 'all' ? 'all' : 'chosen',
        qualifications: type.appliesTo === 'all' ? [] : [...type.appliesTo], validity: type.validityMonths === null ? '' : String(type.validityMonths),
        templateId: type.templateId ?? 0, active: type.active,
      }
    : { name: '', folder: folders.value[0] ?? 'contract', applies: 'all', qualifications: [], validity: '', templateId: 0, active: true })
  open.value = true
  templates.value = await $fetch<PrintTemplateDto[]>('/api/print-templates').catch(() => [])
}

const body = (): RequiredDocumentTypeInput => ({
  name: form.name, folder: form.folder,
  appliesTo: form.applies === 'all' || form.qualifications.length === 0 ? 'all' : form.qualifications,
  validityMonths: form.validity.trim() === '' ? null : Number(form.validity), templateId: form.templateId || null, active: form.active,
})

async function save() {
  const id = editing.value?.id
  const ok = await run(() => (id
    ? $fetch<{ ok: boolean }>(`/api/required-document-types/${id}`, { method: 'PUT', body: body() })
    : $fetch<{ id: number }>('/api/required-document-types', { method: 'POST', body: body() })), de.common.saved)
  if (ok) open.value = false
}

async function remove(type: RequiredDocumentTypeDto) {
  if (!await confirm(t.deleteConfirm(type.name))) return
  await run(() => $fetch<{ ok: boolean }>(`/api/required-document-types/${type.id}`, { method: 'DELETE' }), de.common.deleted)
}

const move = (type: RequiredDocumentTypeDto, direction: 'up' | 'down') =>
  run(() => $fetch<{ ok: boolean }>(`/api/required-document-types/${type.id}/move`, { method: 'POST', body: { direction } }))

/** „Fach · 5 Jahre gültig · nur Fachkraft · Vorlage“ under the name. */
function details(type: RequiredDocumentTypeDto): string {
  return [
    de.personnel.folders[type.folder],
    type.validityMonths === null ? '' : t.validFor(type.validityMonths),
    type.appliesTo === 'all' ? '' : t.forQualifications(type.appliesTo.map(key => de.staffing.qualifications[key])),
    type.templateTitle ?? '',
    type.active ? '' : t.inactive,
  ].filter(part => part !== '').join(' · ')
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ t.title }}</h2>
      <div class="flex flex-wrap gap-2 sm:ml-auto">
        <ReorderToggle v-if="(types?.length ?? 0) > 1" v-model="reordering" />
        <UButton v-if="folders.length" icon="i-lucide-plus" size="sm" :label="t.add" @click="openDialog(null)" />
      </div>
    </div>
    <p class="text-xs text-gray-500">{{ t.settingsHint }}</p>
    <p v-if="!folders.length" class="text-sm text-gray-500">{{ t.noFolders }}</p>
    <p v-else-if="!types?.length" class="text-sm text-gray-500">{{ t.none }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="(type, index) in types" :key="type.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <div class="min-w-0 flex-1">
          <div class="font-medium" :class="type.active ? '' : 'text-gray-500'">{{ type.name }}</div>
          <div class="text-xs text-gray-500">{{ details(type) }}</div>
        </div>
        <div class="flex items-center gap-1">
          <!-- ▲/▼ only after „Reihenfolge ändern“; on phones „Löschen“ sits in „⋯“. -->
          <template v-if="reordering">
            <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveUp}: ${type.name}`" :disabled="busy || index === 0" @click="move(type, 'up')" />
            <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveDown}: ${type.name}`" :disabled="busy || index === types.length - 1" @click="move(type, 'down')" />
          </template>
          <RowActions
            v-else :name="type.name" :actions="[
              { key: 'edit', label: t.edit, icon: 'i-lucide-pencil', variant: 'ghost', iconOnly: true, disabled: busy, onClick: () => openDialog(type) },
              { key: 'delete', label: de.common.delete, icon: 'i-lucide-trash-2', color: 'error', variant: 'ghost', iconOnly: true, disabled: busy, onClick: () => remove(type) },
            ]"
          />
        </div>
      </li>
    </ul>

    <UModal v-model:open="open" :title="editing ? t.edit : t.add">
      <template #body>
        <form class="space-y-3" @submit.prevent="save">
          <UFormField :label="t.name" required>
            <UInput v-model="form.name" :maxlength="REQUIRED_DOCUMENT_LIMITS.name" class="w-full" required />
          </UFormField>
          <UFormField :label="t.folder">
            <USelect v-model="form.folder" :items="folderItems" class="w-full" />
          </UFormField>
          <UFormField :label="t.appliesTo">
            <URadioGroup v-model="form.applies" :items="appliesItems" orientation="horizontal" />
            <div v-if="form.applies === 'chosen'" class="mt-2 grid gap-1 sm:grid-cols-2">
              <UCheckbox
                v-for="item in qualificationItems" :key="item.value" :label="item.label" :model-value="form.qualifications.includes(item.value)"
                @update:model-value="value => form.qualifications = value === true ? [...form.qualifications, item.value] : form.qualifications.filter(key => key !== item.value)"
              />
            </div>
          </UFormField>
          <UFormField :label="t.validity" :description="t.validityHint">
            <UInput v-model="form.validity" type="number" min="1" :max="REQUIRED_DOCUMENT_LIMITS.validityMonths" step="1" class="w-28" />
          </UFormField>
          <UFormField :label="t.template">
            <USelect v-model="form.templateId" :items="templateItems" class="w-full" />
          </UFormField>
          <UCheckbox v-model="form.active" :label="t.active" />
          <div class="flex gap-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
