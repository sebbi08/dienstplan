<script setup lang="ts">
import type { WeekTemplateApplyResult, WeekTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** Saves the chosen plan week as a template (mode 'save') or inserts a template into it (mode 'apply'). */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ mode: 'save' | 'apply'; weekStart: string }>()
const emit = defineEmits<{ done: [] }>()

const toast = useToast()
const confirm = useConfirm()
const run = useAction(async () => emit('done'))
const templates = ref<WeekTemplateDto[] | null>(null)
const name = ref('')
const templateId = ref<number | undefined>(undefined)

watch(open, async (isOpen) => {
  if (!isOpen) return
  name.value = ''
  templateId.value = undefined
  templates.value = null
  templates.value = await $fetch<WeekTemplateDto[]>('/api/week-templates').catch(() => [])
})

const items = computed(() => (templates.value ?? []).map(template => ({ label: template.name, value: template.id })))
const chosen = computed(() => templates.value?.find(template => template.id === templateId.value))

async function save() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  if (templates.value?.some(template => template.name === trimmed)
    && !await confirm(de.weekTemplates.replaceConfirm(trimmed), { danger: false, confirmLabel: de.weekTemplates.replace })) return
  const ok = await run(() => $fetch<unknown>('/api/week-templates', { method: 'POST', body: { name: trimmed, weekStart: props.weekStart } }),
    de.weekTemplates.saved)
  if (ok) open.value = false
}

async function apply() {
  if (templateId.value === undefined) return
  let result: WeekTemplateApplyResult | undefined
  const ok = await run(async () => {
    result = await $fetch<WeekTemplateApplyResult>(`/api/week-templates/${templateId.value}/apply`, {
      method: 'POST', body: { weekStart: props.weekStart },
    })
  })
  if (!ok || !result) return
  toast.add({ title: de.weekTemplates.applied(result.filled, result.skipped), color: result.filled ? 'success' : 'warning' })
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open" :ui="{ content: 'sm:max-w-2xl' }"
    :title="mode === 'save' ? de.weekTemplates.saveTitle(formatDate(weekStart)) : de.weekTemplates.applyTitle(formatDate(weekStart))"
  >
    <template #body>
      <form v-if="mode === 'save'" class="space-y-3" @submit.prevent="save">
        <p class="text-sm text-gray-500">{{ de.weekTemplates.saveHint }}</p>
        <UFormField :label="de.weekTemplates.name">
          <UInput v-model="name" maxlength="100" list="week-template-names" class="w-full" autofocus required />
          <datalist id="week-template-names">
            <option v-for="template in templates ?? []" :key="template.id" :value="template.name" />
          </datalist>
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
      <form v-else class="space-y-3" @submit.prevent="apply">
        <p class="text-sm text-gray-500">{{ de.weekTemplates.applyHint }}</p>
        <p v-if="templates && !templates.length" class="text-sm">{{ de.weekTemplates.none }}</p>
        <template v-else>
          <UFormField :label="de.weekTemplates.template">
            <USelect v-model="templateId" :items="items" class="w-full" />
          </UFormField>
          <WeekTemplatePreview v-if="chosen" :template="chosen" />
        </template>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.weekTemplates.applyWeek" :disabled="templateId === undefined" />
        </div>
      </form>
    </template>
  </UModal>
</template>
