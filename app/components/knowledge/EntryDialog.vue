<script setup lang="ts">
import { KNOWLEDGE_KINDS, KNOWLEDGE_LIMITS, type KnowledgeKind } from '#shared/domain/knowledge'
import { sameTextAnswer } from '#shared/domain/richText'
import { TEMPLATE_VISIBILITIES, visibleTemplateLevels, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { KnowledgeCategoryDto, KnowledgeEntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'

/**
 * Creating or changing an entry of „Wissen“ (knowledge.manage): a PDF, a link or a short formatted text in one of the
 * facility's categories, or, for the Träger (knowledge.global), for all facilities under a category name with its own
 * visibility. „Gelesen und verstanden erforderlich“ asks the readers to confirm; a change of the file, the link or the
 * text asks them again (the dialog says so before saving). Where an entry is kept is chosen once, when it is created.
 */
const props = defineProps<{
  /** null = a new entry. */
  entry: KnowledgeEntryDto | null
  categories: KnowledgeCategoryDto[]
  canManageGlobal: boolean
  /** The category a new entry starts in (the open sub-tab). */
  presetCategoryId: number | null
  refresh: () => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { required: true })

const t = de.knowledge
const f = t.fields
const { user } = useUserSession()
const { activeName } = useFacilities()
const { busy, run } = useBusyAction(props.refresh)
const toast = useToast()

interface Form {
  kind: KnowledgeKind; title: string; description: string; asOf: string; url: string; body: string; needsConfirmation: boolean
  scope: 'facility' | 'all'; categoryId: number | undefined; categoryName: string; visibility: TemplateVisibility
}
const empty = (): Form => ({
  kind: 'link', title: '', description: '', asOf: '', url: '', body: '', needsConfirmation: false, scope: 'facility',
  categoryId: undefined, categoryName: '', visibility: 'all',
})
const form = reactive<Form>(empty())
const file = shallowRef<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const forAll = computed(() => (props.entry ? props.entry.global : form.scope === 'all'))
const kindItems = KNOWLEDGE_KINDS.map(kind => ({ label: t.kindLabels[kind], value: kind }))
const categoryItems = computed(() => props.categories.map(category => ({ label: category.name, value: category.id })))
const scopeItems = computed(() => [
  { label: activeName.value ? t.scopeFacility(activeName.value) : t.scopeThisFacility, value: 'facility' },
  { label: t.scopeAll, value: 'all' },
])
const levels = computed(() => (user.value ? visibleTemplateLevels(user.value.role) : []))
const visibilityItems = computed(() => TEMPLATE_VISIBILITIES.filter(level => levels.value.includes(level))
  .map(level => ({ label: t.categories.visibilities[level], value: level })))

// The category names the facilities use, loaded when the Träger files an entry for all facilities.
const categoryNames = ref<string[]>([])
async function loadCategoryNames() {
  if (!props.canManageGlobal) return
  categoryNames.value = await $fetch<string[]>('/api/knowledge-categories/names').catch(() => categoryNames.value)
}
watch(forAll, (value) => { if (value && open.value) loadCategoryNames() })

watch(open, (isOpen) => {
  if (!isOpen) return
  file.value = null
  if (fileInput.value) fileInput.value.value = ''
  const entry = props.entry
  if (entry) {
    Object.assign(form, {
      kind: entry.kind, title: entry.title, description: entry.description, asOf: entry.asOf ?? '', url: entry.url, body: entry.body,
      needsConfirmation: entry.needsConfirmation, scope: entry.global ? 'all' : 'facility', categoryId: entry.categoryId ?? undefined,
      categoryName: entry.globalCategoryName ?? '', visibility: entry.globalVisibility ?? 'all',
    })
    if (entry.global) loadCategoryNames()
  }
  else {
    const preset = props.presetCategoryId ?? (props.categories.length === 1 ? props.categories[0]!.id : undefined)
    Object.assign(form, { ...empty(), categoryId: preset, categoryName: props.categories.find(category => category.id === preset)?.name ?? '' })
  }
}, { immediate: true })

function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  if (file.value && form.title.trim() === '') form.title = file.value.name.replace(/\.[^.]*$/, '').trim().slice(0, KNOWLEDGE_LIMITS.title)
}

/** Whether saving changes the content (another kind, a new file, another link or text): everyone confirms again. */
const contentChanged = computed(() => {
  const entry = props.entry
  if (!entry) return false
  if (form.kind !== entry.kind || file.value !== null) return true
  if (form.kind === 'link') return form.url.trim() !== entry.url
  if (form.kind === 'text') return !sameTextAnswer(form.body, entry.body)
  return false
})

async function save() {
  const chosen = file.value
  if (form.kind === 'file' && !chosen && props.entry?.kind !== 'file') return void toast.add({ title: de.errors.file_required, color: 'error' })
  // Fails early instead of after a long upload; the server checks the size and the real file type again.
  if (chosen && form.kind === 'file' && chosen.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: de.errors.document_too_large, color: 'error' })
  const body = new FormData()
  const fields: Record<string, string> = {
    kind: form.kind, title: form.title, description: form.description, asOf: form.asOf,
    url: form.kind === 'link' ? form.url : '', body: form.kind === 'text' ? form.body : '',
    needsConfirmation: String(form.needsConfirmation),
    ...(props.entry ? {} : { scope: forAll.value ? 'all' : 'facility' }),
    ...(forAll.value ? { categoryName: form.categoryName, visibility: form.visibility } : form.categoryId !== undefined ? { categoryId: String(form.categoryId) } : {}),
  }
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  if (chosen && form.kind === 'file') body.append('file', chosen)
  const saved = await run(() => (props.entry
    ? $fetch<{ ok: boolean }>(`/api/knowledge/${props.entry.id}`, { method: 'PUT', body })
    : $fetch<{ id: number }>('/api/knowledge', { method: 'POST', body })), de.common.saved)
  if (saved) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="entry ? t.edit : t.add" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <UAlert v-if="!categories.length && !forAll && !canManageGlobal" color="warning" variant="soft" :title="t.noCategory" />
      <form v-else class="grid gap-3" @submit.prevent="save">
        <UFormField :label="f.kind">
          <URadioGroup v-model="form.kind" :items="kindItems" orientation="horizontal" />
        </UFormField>
        <UFormField v-if="canManageGlobal && !entry" :label="f.scope">
          <USelect v-model="form.scope" :items="scopeItems" class="w-full" />
        </UFormField>
        <template v-if="forAll">
          <UFormField :label="f.categoryName" :description="t.categoryNameHint" required>
            <UInput v-model="form.categoryName" :maxlength="KNOWLEDGE_LIMITS.categoryName" class="w-full" list="knowledge-category-names" required autocomplete="off" />
            <datalist id="knowledge-category-names">
              <option v-for="name in categoryNames" :key="name" :value="name" />
            </datalist>
          </UFormField>
          <UFormField :label="f.visibility" :description="t.visibilityHint">
            <USelect v-model="form.visibility" :items="visibilityItems" class="w-full" />
          </UFormField>
        </template>
        <template v-else>
          <UAlert v-if="!categories.length" color="warning" variant="soft" :title="t.noCategory" />
          <UFormField v-else :label="f.category" required>
            <USelect v-model="form.categoryId" :items="categoryItems" :placeholder="t.categoryPlaceholder" class="w-full" required />
          </UFormField>
        </template>

        <UFormField v-if="form.kind === 'file'" :label="entry?.kind === 'file' ? f.replaceFile : f.file" :required="entry?.kind !== 'file'"
          :description="entry?.kind === 'file' && entry.fileSize ? t.currentFile(formatSize(entry.fileSize)) : undefined"
        >
          <input
            ref="fileInput" type="file" accept="application/pdf,.pdf" :required="entry?.kind !== 'file'"
            class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
            @change="onFile"
          >
        </UFormField>
        <UFormField :label="f.title" required>
          <UInput v-model="form.title" :maxlength="KNOWLEDGE_LIMITS.title" class="w-full" required />
        </UFormField>
        <UFormField v-if="form.kind === 'link'" :label="f.url" required>
          <UInput v-model="form.url" type="url" inputmode="url" :maxlength="KNOWLEDGE_LIMITS.url" :placeholder="t.urlPlaceholder" class="w-full" required />
        </UFormField>
        <div v-if="form.kind === 'text'" class="space-y-1">
          <span id="knowledge-body-label" class="block text-sm font-medium">{{ f.body }} <span class="text-red-600" aria-hidden="true">*</span></span>
          <FormsRichTextInput v-model="form.body" labelledby="knowledge-body-label" />
        </div>
        <UFormField :label="f.description">
          <UTextarea v-model="form.description" :rows="2" :maxlength="KNOWLEDGE_LIMITS.description" class="w-full" />
        </UFormField>
        <UFormField :label="f.asOf">
          <DateTextInput v-model="form.asOf" :label="f.asOf" class="w-full sm:w-48" />
        </UFormField>
        <UFormField :description="t.needsConfirmationHint">
          <UCheckbox v-model="form.needsConfirmation" class="min-h-11 items-center" :label="f.needsConfirmation" />
        </UFormField>
        <UAlert v-if="contentChanged && entry?.needsConfirmation && form.needsConfirmation" color="warning" variant="soft" :title="t.contentChangeHint" />
        <div class="flex gap-2">
          <UButton type="submit" :label="entry ? de.common.save : t.add" :loading="busy" :disabled="busy" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
