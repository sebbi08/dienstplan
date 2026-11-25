<script setup lang="ts">
import type { VisitFormListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'

/**
 * „Bögen“ of an info visit or an applicant: start one from a template of the matching kind („Infogespräch“ /
 * „Hospitation“, made under Dokumente → Bögen), open one to fill it in (one at a time; leaving unsaved answers asks
 * first), delete one. Read only without `editable`.
 */
const props = defineProps<{
  kind: 'info' | 'applicant'
  recordId: number
  forms: VisitFormListItemDto[]
  templates: { id: number; name: string }[]
  editable: boolean
  refreshList: () => Promise<unknown>
}>()
const t = de.visits
const toast = useToast()
const confirm = useConfirm()
const templateId = ref<number | undefined>(undefined)
watch(() => props.templates, (list) => {
  if (templateId.value === undefined || !list.some(template => template.id === templateId.value)) templateId.value = list[0]?.id
}, { immediate: true })
const templateItems = computed(() => props.templates.map(template => ({ label: template.name, value: template.id })))

const openId = ref<number | null>(null)
const openDirty = ref(false)
async function toggle(id: number) {
  if (openDirty.value && !await confirm(de.forms.closeConfirm, { confirmLabel: de.forms.closeDiscard })) return
  openDirty.value = false
  openId.value = openId.value === id ? null : id
}

const creating = ref(false)
async function create() {
  if (templateId.value === undefined || creating.value) return
  creating.value = true
  try {
    const { id } = await $fetch<{ id: number }>(`/api/${props.kind === 'info' ? 'info-visits' : 'applicant-visits'}/${props.recordId}/forms`, {
      method: 'POST', body: { templateId: templateId.value },
    })
    await props.refreshList()
    openDirty.value = false
    openId.value = id
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    creating.value = false
  }
}
async function remove(form: VisitFormListItemDto) {
  if (!await confirm(t.deleteFormConfirm(form.title))) return
  try {
    await $fetch<unknown>(`/api/visit-forms/${form.id}`, { method: 'DELETE' })
    if (openId.value === form.id) openId.value = null
    await props.refreshList()
    toast.add({ title: de.common.deleted, color: 'success' })
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
}
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.forms }}</h2>
    <div v-if="editable" class="flex flex-wrap items-end gap-2">
      <template v-if="templates.length">
        <UFormField :label="t.chooseTemplate" class="min-w-56">
          <USelect v-model="templateId" :items="templateItems" class="w-full" />
        </UFormField>
        <UButton icon="i-lucide-plus" :label="t.addForm" :loading="creating" :disabled="creating || templateId === undefined" @click="create" />
      </template>
      <p v-else class="text-sm text-gray-600">{{ t.noTemplates }}</p>
    </div>
    <p v-if="!forms.length" class="text-sm text-gray-500">{{ t.noForms }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="form in forms" :key="form.id" class="py-1">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button" class="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm" :aria-expanded="openId === form.id"
            @click="toggle(form.id)"
          >
            <UIcon :name="openId === form.id ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 shrink-0 text-gray-400" />
            <span class="font-medium">{{ form.title }}</span>
            <span class="text-xs text-gray-500">{{ de.forms.lastChanged(form.updatedBy, formatDateTime(form.updatedAt)) }}</span>
          </button>
          <UButton
            v-if="editable" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.deleteForm"
            :aria-label="`${t.deleteForm}: ${form.title}`" @click="remove(form)"
          />
        </div>
        <VisitsFormView v-if="openId === form.id" :form-id="form.id" :editable="editable" :refresh-list="refreshList" @dirty="openDirty = $event" />
      </li>
    </ul>
  </section>
</template>
