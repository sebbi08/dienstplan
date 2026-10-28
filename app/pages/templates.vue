<script setup lang="ts">
import type { PrintTemplateDto, PrintTemplateScope, TemplateCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { berlinDay, groupByCategory, templateFileUrl, titleFromFileName } from '~/utils/printTemplates'

/**
 * Blank PDF forms to open and print, by category: Träger and Leitung upload and maintain them and their categories,
 * the tablet (no unlock, they are no child data) and Mitarbeiter accounts only open them. Each sees the categories of
 * their level (the server filters).
 */
const { user } = useUserSession()
const { can } = useCan()
const manager = computed(() => can('printTemplates.edit'))
// „für alle Einrichtungen“ and the categories for the Träger alone (printTemplates.global, the Träger's).
const isProvider = computed(() => can('printTemplates.global'))
const onTablet = computed(() => user.value?.role === 'terminal')
const { activeName } = useFacilities()

const { data, refresh: refreshTemplates, error } = await useFetch<PrintTemplateDto[]>('/api/print-templates', { default: () => [] })
const { data: categoryData, refresh: refreshCategories } = await useFetch<TemplateCategoryDto[]>('/api/template-categories', { default: () => [] })
const templates = computed(() => data.value ?? [])
const categories = computed(() => categoryData.value ?? [])
const groups = computed(() => groupByCategory(categories.value, templates.value))
const categoryItems = computed(() => categories.value.map(category => ({ label: category.name, value: category.id })))
const refresh = () => Promise.all([refreshTemplates(), refreshCategories()])

const { busy, run } = useBusyAction(refresh)
const confirm = useConfirm()
const toast = useToast()

const open = ref(false)
const managing = ref(false)
/** null = a new upload, otherwise the template being changed. */
const editingId = ref<number | null>(null)
const file = shallowRef<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const form = reactive<{ title: string; categoryId: number | undefined; scope: PrintTemplateScope }>({
  title: '', categoryId: undefined, scope: 'facility',
})
/** The title the last chosen file suggested; a title typed by hand is not overwritten by the next file. */
let suggestedTitle = ''

const scopeItems = computed(() => [
  { label: activeName.value ? de.printTemplates.scopeFacility(activeName.value) : de.printTemplates.scopeThisFacility, value: 'facility' },
  { label: de.printTemplates.scopeAll, value: 'all' },
])

function resetFile() {
  file.value = null
  suggestedTitle = ''
  if (fileInput.value) fileInput.value.value = ''
}

function openNew() {
  editingId.value = null
  resetFile()
  // With a single category there is nothing to choose.
  Object.assign(form, { title: '', categoryId: categories.value.length === 1 ? categories.value[0]!.id : undefined, scope: 'facility' })
  open.value = true
}

function openEdit(template: PrintTemplateDto) {
  editingId.value = template.id
  resetFile()
  Object.assign(form, { title: template.title, categoryId: template.categoryId, scope: template.global ? 'all' : 'facility' })
  open.value = true
}

function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  if (!file.value || editingId.value !== null) return
  if (form.title.trim() === '' || form.title === suggestedTitle) form.title = titleFromFileName(file.value.name)
  suggestedTitle = form.title
}

/** Fails early instead of after a long upload; the server checks the size and the real file type again. */
function checkFile(chosen: File): boolean {
  if (chosen.size > MAX_DOCUMENT_BYTES) {
    toast.add({ title: de.errors.document_too_large, color: 'error' })
    return false
  }
  return true
}

function fileBody(chosen: File): FormData {
  const body = new FormData()
  body.append('file', chosen)
  return body
}

async function save() {
  const chosen = file.value
  const categoryId = form.categoryId
  if (categoryId === undefined) return void toast.add({ title: de.errors.template_category_invalid, color: 'error' })
  if (editingId.value === null) {
    if (!chosen) return void toast.add({ title: de.errors.file_required, color: 'error' })
    if (!checkFile(chosen)) return
    const body = fileBody(chosen)
    body.append('title', form.title)
    body.append('categoryId', String(categoryId))
    body.append('scope', isProvider.value ? form.scope : 'facility')
    if (await run(() => $fetch<unknown>('/api/print-templates', { method: 'POST', body }), de.common.saved)) open.value = false
    return
  }
  const id = editingId.value
  if (chosen && !checkFile(chosen)) return
  const saved = await run(async () => {
    await $fetch<unknown>(`/api/print-templates/${id}`, { method: 'PUT', body: { title: form.title, categoryId } })
    if (chosen) await $fetch<unknown>(`/api/print-templates/${id}/file`, { method: 'PUT', body: fileBody(chosen) })
  }, de.common.saved)
  if (saved) open.value = false
}

async function remove(template: PrintTemplateDto) {
  if (await confirm(de.printTemplates.confirmDelete(template.title))) {
    run(() => $fetch<unknown>(`/api/print-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.printTemplates.title }}</h1>
      <div class="ml-auto flex flex-wrap gap-2">
        <UButton v-if="manager" color="neutral" variant="outline" icon="i-lucide-folder-cog" :label="de.printTemplates.manageCategories" @click="managing = true" />
        <UButton v-if="manager" icon="i-lucide-upload" :label="de.printTemplates.upload" @click="openNew" />
        <UButton v-if="onTablet" size="lg" color="neutral" variant="outline" icon="i-lucide-arrow-left" :label="de.terminal.toStart" to="/terminal" />
      </div>
    </div>
    <p class="text-sm text-gray-600">{{ de.printTemplates.intro }}</p>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <p v-else-if="!groups.length" class="text-sm text-gray-500">{{ de.printTemplates.none }}</p>

    <section v-for="group in groups" :key="group.category.id" class="rounded-lg bg-white ring-1 ring-gray-200">
      <h2 class="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 font-semibold">
        {{ group.category.name }}
        <span v-if="group.category.visibility !== 'all'" class="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">
          {{ de.printTemplates.visibilityBadge[group.category.visibility] }}
        </span>
      </h2>
      <ul class="divide-y divide-gray-100">
        <li v-for="template in group.templates" :key="template.id" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <UIcon name="i-lucide-file-text" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
          <!-- At least 12rem for the text; on a narrow screen the buttons move to their own line instead. -->
          <div class="min-w-48 flex-1 space-y-0.5">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-medium">{{ template.title }}</span>
              <span v-if="template.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="de.printTemplates.globalHint">{{ de.printTemplates.global }}</span>
            </div>
            <p class="text-xs text-gray-500">
              {{ de.printTemplates.uploadedAt(formatDate(berlinDay(template.uploadedAt))) }}
              <template v-if="berlinDay(template.updatedAt) !== berlinDay(template.uploadedAt)"> · {{ de.printTemplates.updatedAt(formatDate(berlinDay(template.updatedAt))) }}</template>
              · {{ formatSize(template.size) }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <UButton
              :to="templateFileUrl(template.id)" target="_blank" external size="sm" color="neutral" variant="outline"
              icon="i-lucide-printer" :label="de.printTemplates.open"
            />
            <template v-if="manager && template.canEdit">
              <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="de.common.edit" :disabled="busy" @click="openEdit(template)" />
              <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" :disabled="busy" @click="remove(template)" />
            </template>
          </div>
        </li>
      </ul>
    </section>

    <UModal v-if="manager" v-model:open="open" :title="editingId === null ? de.printTemplates.upload : de.printTemplates.edit">
      <template #body>
        <UAlert v-if="!categories.length" color="warning" variant="soft" :title="de.printTemplates.noCategory" />
        <form v-else class="grid gap-3" @submit.prevent="save">
          <UFormField :label="editingId === null ? de.printTemplates.file : de.printTemplates.replaceFile" :required="editingId === null">
            <input
              ref="fileInput" type="file" accept="application/pdf,.pdf" :required="editingId === null"
              class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
              @change="onFile"
            >
          </UFormField>
          <UFormField :label="de.printTemplates.name" :required="editingId !== null">
            <UInput v-model="form.title" maxlength="200" class="w-full" :required="editingId !== null" />
          </UFormField>
          <UFormField :label="de.printTemplates.category" required>
            <USelect v-model="form.categoryId" :items="categoryItems" :placeholder="de.printTemplates.categoryPlaceholder" class="w-full" />
          </UFormField>
          <UFormField v-if="isProvider && editingId === null" :label="de.printTemplates.scope">
            <USelect v-model="form.scope" :items="scopeItems" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="editingId === null ? de.printTemplates.upload : de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>

    <TemplatesCategoryManager v-if="manager" v-model:open="managing" :categories="categories" :is-provider="isProvider" :refresh="refresh" />
  </div>
</template>
