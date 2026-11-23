<script setup lang="ts">
import { KNOWLEDGE_KINDS, KNOWLEDGE_LIMITS, type KnowledgeKind } from '#shared/domain/knowledge'
import { sameTextAnswer } from '#shared/domain/richText'
import { TEMPLATE_VISIBILITIES, visibleTemplateLevels, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { CategoryNameDto, DocumentTargetOptionsDto, KnowledgeCategoryDto, KnowledgeEntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { pickedFile, uploadSizeError } from '~/utils/uploads'
import {
  emptyTargets, facilitiesLost, targetsFormOf, targetsNeedChoice, targetsPayload, targetsProblem, type TargetsForm,
} from '~/utils/documentTargets'
import { filedCategoryId, subcategoryItems, subcategoryNamesFor, topCategories } from '~/utils/subcategories'

/**
 * Creating or changing an entry of „Wissen“ (knowledge.manage): a PDF, a link or a short formatted text in one of the
 * facility's categories (and maybe one of its subcategories), or, for the Träger (knowledge.global), for all facilities
 * under a category name (and maybe a subcategory name) with its own visibility. „Gelesen und verstanden erforderlich“
 * asks the readers to confirm; a change of the file, the link or the text asks them again (the dialog says so before
 * saving). Where an entry is kept is chosen once, when it is created. Filed elsewhere, an entry goes to the end there.
 */
const props = defineProps<{
  /** null = a new entry. */
  entry: KnowledgeEntryDto | null
  categories: KnowledgeCategoryDto[]
  canManageGlobal: boolean
  /** The category a new entry starts in (the open sub-tab), and the subcategory (the open small tab). */
  presetCategoryId: number | null
  presetSubcategoryId: number | null
  refresh: () => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { required: true })

const t = de.knowledge
const f = t.fields
const { user } = useUserSession()
const { activeName } = useFacilities()
const { busy, run } = useBusyAction(props.refresh)
const toast = useToast()

/** `subcategoryId` 0 = directly in the category („Allgemein“); `subcategoryName` '' = none (an entry for all facilities). */
interface Form {
  kind: KnowledgeKind; title: string; description: string; asOf: string; url: string; body: string; needsConfirmation: boolean
  targets: TargetsForm; categoryId: number | undefined; subcategoryId: number; categoryName: string; subcategoryName: string
  visibility: TemplateVisibility
}
const empty = (): Form => ({
  kind: 'link', title: '', description: '', asOf: '', url: '', body: '', needsConfirmation: false, targets: emptyTargets(),
  categoryId: undefined, subcategoryId: 0, categoryName: '', subcategoryName: '', visibility: 'all',
})
const form = reactive<Form>(empty())
const file = shallowRef<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/** For all or the chosen facilities (the Träger's): filed by category name. */
const forAll = computed(() => form.targets.scope !== 'facility')
const confirm = useConfirm()
// What „Gilt für“ offers (the Träger every facility with its groups, everyone else the own facility), loaded with the form.
// Saving waits for them (else a limit could not be shown and kept); a failed load offers to try again. „Gilt für“ is sent
// only when the editor changed it, otherwise the server keeps it as it is.
const targetOptions = ref<DocumentTargetOptionsDto | null>(null)
const targetsFailed = ref(false)
const targetsTouched = ref(false)
async function loadTargetOptions() {
  targetsFailed.value = false
  try {
    targetOptions.value = await $fetch<DocumentTargetOptionsDto>('/api/knowledge/targets')
  }
  catch {
    targetsFailed.value = true
  }
}
const kindItems = KNOWLEDGE_KINDS.map(kind => ({ label: t.kindLabels[kind], value: kind }))
const categoryItems = computed(() => topCategories(props.categories).map(category => ({ label: category.name, value: category.id })))
const subcategoryChoices = computed(() => subcategoryItems(props.categories, form.categoryId, t.noSubcategory))
// Another category: a subcategory of the one before no longer fits.
watch(() => form.categoryId, () => {
  if (!subcategoryChoices.value.some(item => item.value === form.subcategoryId)) form.subcategoryId = 0
})
const levels = computed(() => (user.value ? visibleTemplateLevels(user.value.role) : []))
const visibilityItems = computed(() => TEMPLATE_VISIBILITIES.filter(level => levels.value.includes(level))
  .map(level => ({ label: t.categories.visibilities[level], value: level })))

// The category names the facilities use, loaded when the Träger files an entry for all facilities.
const categoryNames = ref<CategoryNameDto[]>([])
async function loadCategoryNames() {
  if (!props.canManageGlobal) return
  categoryNames.value = await $fetch<CategoryNameDto[]>('/api/knowledge-categories/names').catch(() => categoryNames.value)
}
/** The subcategory names used under the typed category name, as suggestions. */
const subcategoryNames = computed(() => subcategoryNamesFor(categoryNames.value, form.categoryName))
watch(forAll, (value) => { if (value && open.value) loadCategoryNames() })

watch(open, (isOpen) => {
  if (!isOpen) return
  // Without a facility or a group left the section must be filled in: checked like a change.
  targetsTouched.value = targetsNeedChoice(props.entry?.targets ?? null)
  loadTargetOptions()
  file.value = null
  if (fileInput.value) fileInput.value.value = ''
  const entry = props.entry
  if (entry) {
    Object.assign(form, {
      kind: entry.kind, title: entry.title, description: entry.description, asOf: entry.asOf ?? '', url: entry.url, body: entry.body,
      needsConfirmation: entry.needsConfirmation, targets: targetsFormOf(entry.targets), categoryId: entry.categoryId ?? undefined,
      subcategoryId: entry.subcategoryId ?? 0,
      // Turned into one for several facilities, it is filed by the name of its category now (preselected).
      categoryName: entry.globalCategoryName ?? props.categories.find(category => category.id === entry.categoryId)?.name ?? '',
      subcategoryName: entry.globalSubcategoryName ?? props.categories.find(category => category.id === entry.subcategoryId)?.name ?? '',
      visibility: entry.visibility,
    })
    if (entry.global) loadCategoryNames()
  }
  else {
    const tops = topCategories(props.categories)
    const preset = props.presetCategoryId ?? (tops.length === 1 ? tops[0]!.id : undefined)
    const sub = props.categories.find(category => category.id === props.presetSubcategoryId && category.parentId === preset)
    Object.assign(form, {
      ...empty(), categoryId: preset, subcategoryId: sub?.id ?? 0,
      categoryName: tops.find(category => category.id === preset)?.name ?? '', subcategoryName: sub?.name ?? '',
    })
  }
}, { immediate: true })

function onFile(event: Event) {
  file.value = pickedFile(event, toast)
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
  if (chosen && form.kind === 'file' && chosen.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: uploadSizeError(chosen.size)!, color: 'error' })
  if (!targetOptions.value) return
  const ownFacilityId = targetOptions.value.facilityId
  // Only a changed „Gilt für“ is sent (checked first); untouched, the server keeps it.
  const problem = targetsTouched.value ? targetsProblem(form.targets, targetOptions.value, ownFacilityId) : null
  if (problem) return void toast.add({ title: problem.kind === 'facility' ? de.documentTargets.pickFacility : de.documentTargets.pickGroup(problem.facility), color: 'error' })
  const targets = targetsPayload(form.targets, targetOptions.value, ownFacilityId)
  // Facilities that lose the entry: ask first.
  const lost = props.entry && targetsTouched.value ? facilitiesLost(props.entry.targets, form.targets, targetOptions.value, ownFacilityId) : 0
  if (lost > 0 && !(await confirm(de.documentTargets.confirmLosing(lost, 'der Eintrag')))) return
  const body = new FormData()
  // A facility's entry: the subcategory chosen, else the category; for all or the chosen facilities the names.
  const categoryId = filedCategoryId(form.categoryId, form.subcategoryId)
  const fields: Record<string, string> = {
    kind: form.kind, title: form.title, description: form.description, asOf: form.asOf,
    url: form.kind === 'link' ? form.url : '', body: form.kind === 'text' ? form.body : '',
    needsConfirmation: String(form.needsConfirmation),
    visibility: form.visibility,
    ...(targetsTouched.value
      ? { scope: targets.scope, facilityIds: JSON.stringify(targets.facilityIds), groupTargets: JSON.stringify(targets.groupTargets) }
      : {}),
    ...(forAll.value
      ? { categoryName: form.categoryName, subcategoryName: form.subcategoryName }
      : categoryId !== undefined ? { categoryId: String(categoryId) } : {}),
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
        <!-- „Gilt für“: facilities (the Träger) and groups; afterwards too. -->
        <DocumentTargetsField
          v-model="form.targets" :options="targetOptions" :can-global="canManageGlobal" :facility-id="targetOptions?.facilityId ?? null"
          :facility-name="activeName ?? ''" id-prefix="knowledge-targets" @update:model-value="targetsTouched = true"
        />
        <UAlert
          v-if="targetsFailed" color="warning" variant="soft" :title="de.documentTargets.loadFailed"
          :actions="[{ label: de.documentTargets.retry, color: 'neutral', variant: 'outline', onClick: loadTargetOptions }]"
        />
        <template v-if="forAll">
          <UFormField :label="f.categoryName" :description="t.categoryNameHint" required>
            <UInput v-model="form.categoryName" :maxlength="KNOWLEDGE_LIMITS.categoryName" class="w-full" list="knowledge-category-names" required autocomplete="off" />
            <datalist id="knowledge-category-names">
              <option v-for="option in categoryNames" :key="option.name" :value="option.name" />
            </datalist>
          </UFormField>
          <UFormField :label="f.subcategoryName" :description="t.subcategoryNameHint">
            <UInput v-model="form.subcategoryName" :maxlength="KNOWLEDGE_LIMITS.categoryName" class="w-full" list="knowledge-subcategory-names" autocomplete="off" />
            <datalist id="knowledge-subcategory-names">
              <option v-for="name in subcategoryNames" :key="name" :value="name" />
            </datalist>
          </UFormField>
        </template>
        <template v-else>
          <UAlert v-if="!categories.length" color="warning" variant="soft" :title="t.noCategory" />
          <template v-else>
            <UFormField :label="f.category" required>
              <USelect v-model="form.categoryId" :items="categoryItems" :placeholder="t.categoryPlaceholder" class="w-full" required />
            </UFormField>
            <!-- Only when the chosen category has subcategories. -->
            <UFormField v-if="subcategoryChoices.length > 1" :label="f.subcategory">
              <USelect v-model="form.subcategoryId" :items="subcategoryChoices" class="w-full" />
            </UFormField>
          </template>
        </template>
        <UFormField :label="f.visibility" :description="t.visibilityHint">
          <USelect v-model="form.visibility" :items="visibilityItems" class="w-full" />
        </UFormField>

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
          <UButton type="submit" :label="entry ? de.common.save : t.add" :loading="busy" :disabled="busy || !targetOptions" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
