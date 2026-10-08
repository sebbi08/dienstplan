<script setup lang="ts">
import { addDays } from '#shared/domain/dates'
import type { GroupDto, WeekTemplateApplyResult, WeekTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Saves the chosen plan week as a template (mode 'save') or inserts a template into it (mode 'apply'). With groups, a
 * template is for the whole facility or for one group ("Für").
 */
const open = defineModel<boolean>('open', { required: true })
const props = withDefaults(defineProps<{ mode: 'save' | 'apply'; weekStart: string; groups?: GroupDto[] }>(), { groups: () => [] })
const emit = defineEmits<{ done: [] }>()

const toast = useToast()
const confirm = useConfirm()
const run = useAction(async () => emit('done'))
const templates = ref<WeekTemplateDto[] | null>(null)
const name = ref('')
const templateId = ref<number | undefined>(undefined)
/** 0 = the whole facility (the select needs a non-null value). */
const scope = ref(0)
const scopeItems = computed(() => [
  { label: de.weekTemplates.wholeFacility, value: 0 },
  ...props.groups.map(group => ({ label: group.name, value: group.id })),
])
const groupName = (groupId: number | null) => props.groups.find(group => group.id === groupId)?.name ?? null
/** Templates of the chosen scope: their names are offered, and saving under one of them replaces it. */
const sameScope = computed(() => (templates.value ?? []).filter(template => (template.groupId ?? 0) === scope.value))

watch(open, async (isOpen) => {
  if (!isOpen) return
  name.value = ''
  templateId.value = undefined
  scope.value = 0
  templates.value = null
  templates.value = await $fetch<WeekTemplateDto[]>('/api/week-templates').catch(() => [])
})

/** Monday to Friday of the chosen week; empty while no week is chosen yet (the dialog is rendered closed). */
const title = computed(() => {
  if (!props.weekStart) return ''
  const describe = props.mode === 'save' ? de.weekTemplates.saveTitle : de.weekTemplates.applyTitle
  return describe(formatDate(props.weekStart), formatDate(addDays(props.weekStart, 4)))
})

const items = computed(() => (templates.value ?? []).map((template) => {
  const group = groupName(template.groupId)
  return { label: group ? de.weekTemplates.groupLabel(template.name, group) : template.name, value: template.id }
}))
const chosen = computed(() => templates.value?.find(template => template.id === templateId.value))

async function save() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  if (sameScope.value.some(template => template.name === trimmed)
    && !await confirm(de.weekTemplates.replaceConfirm(trimmed), { danger: false, confirmLabel: de.weekTemplates.replace })) return
  const body = { name: trimmed, weekStart: props.weekStart, ...(props.groups.length ? { groupId: scope.value || null } : {}) }
  const ok = await run(() => $fetch<unknown>('/api/week-templates', { method: 'POST', body }), de.weekTemplates.saved)
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
    :title="title"
  >
    <template #body>
      <form v-if="mode === 'save'" class="space-y-3" @submit.prevent="save">
        <p class="text-sm text-gray-500">{{ de.weekTemplates.saveHint }}</p>
        <template v-if="groups.length">
          <UFormField :label="de.weekTemplates.scope">
            <USelect v-model="scope" :items="scopeItems" class="w-full" />
          </UFormField>
          <p class="text-xs text-gray-500">{{ de.weekTemplates.scopeHint }}</p>
        </template>
        <UFormField :label="de.weekTemplates.name">
          <UInput v-model="name" maxlength="100" list="week-template-names" class="w-full" autofocus required />
          <datalist id="week-template-names">
            <option v-for="template in sameScope" :key="template.id" :value="template.name" />
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
