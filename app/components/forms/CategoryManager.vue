<script setup lang="ts">
import type { FormTemplateCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { subcategoriesOf, topCategories } from '~/utils/subcategories'

/**
 * „Kategorien verwalten“ on Dokumente → Bögen (formTemplates.manage), for the facility: create, rename, reorder and delete
 * an empty category without subcategories; each category can have subcategories (one level), shown indented below it.
 */
const props = defineProps<{ categories: FormTemplateCategoryDto[]; refresh: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { required: true })

const { busy, run } = useBusyAction(props.refresh)
const confirm = useConfirm()
const t = de.forms.categories

const tree = computed(() => topCategories(props.categories).map(category => ({ category, subcategories: subcategoriesOf(props.categories, category.id) })))

/** null = a new (sub)category, otherwise the one being renamed; `parent` = the category a new subcategory goes into. */
const editingId = ref<number | null>(null)
const parent = ref<FormTemplateCategoryDto | null>(null)
const name = ref('')
const editingSub = computed(() => parent.value !== null || props.categories.some(category => category.id === editingId.value && category.parentId !== null))
const formTitle = computed(() => {
  if (editingId.value !== null) return editingSub.value ? t.editSub : t.edit
  return parent.value ? t.addSubIn(parent.value.name) : t.add
})
const nameInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('nameInput')
const focusName = () => nextTick(() => nameInput.value?.inputRef?.focus())

function startNew() {
  editingId.value = null
  parent.value = null
  name.value = ''
}
function startSub(category: FormTemplateCategoryDto) {
  editingId.value = null
  parent.value = category
  name.value = ''
  focusName()
}
function startEdit(category: FormTemplateCategoryDto) {
  editingId.value = category.id
  parent.value = null
  name.value = category.name
  focusName()
}
watch(open, (isOpen) => {
  if (isOpen) startNew()
})

async function save() {
  const id = editingId.value
  const saved = await run(() => (id === null
    ? $fetch<{ id: number }>('/api/form-template-categories', { method: 'POST', body: { name: name.value, parentId: parent.value?.id ?? null } })
    : $fetch<{ ok: boolean }>(`/api/form-template-categories/${id}`, { method: 'PUT', body: { name: name.value } })), de.common.saved)
  if (saved) startNew()
}
function move(category: FormTemplateCategoryDto, direction: 'up' | 'down') {
  void run(() => $fetch<{ ok: boolean }>(`/api/form-template-categories/${category.id}/move`, { method: 'POST', body: { direction } }))
}
async function remove(category: FormTemplateCategoryDto) {
  if (!await confirm(category.parentId === null ? t.confirmDelete(category.name) : t.confirmDeleteSub(category.name))) return
  const deleted = await run(() => $fetch<{ ok: boolean }>(`/api/form-template-categories/${category.id}`, { method: 'DELETE' }), de.common.deleted)
  if (deleted && editingId.value === category.id) startNew()
}
/** Why a category cannot be deleted (templates, subcategories), else the button's own label. */
const deleteTitle = (category: FormTemplateCategoryDto, subcategories: number) => {
  if (category.templateCount > 0) return de.errors.form_category_not_empty
  return subcategories > 0 ? de.errors.form_category_has_subcategories : de.common.delete
}
</script>

<template>
  <UModal v-model:open="open" :title="t.manage">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-gray-600">{{ t.intro }}</p>
        <p v-if="!categories.length" class="text-sm text-gray-500">{{ t.noneYet }}</p>
        <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
          <li v-for="({ category, subcategories }, index) in tree" :key="category.id" class="text-sm">
            <div class="flex flex-wrap items-center gap-2 px-3 py-2">
              <div class="min-w-40 flex-1">
                <span class="font-medium">{{ category.name }}</span>
                <span class="block text-xs text-gray-500">
                  {{ t.templateCount(category.templateCount) }}<template v-if="subcategories.length"> · {{ t.subcategoryCount(subcategories.length) }}</template>
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-1">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="`${t.moveUp}: ${category.name}`" :title="t.moveUp" :disabled="busy || index === 0" @click="move(category, 'up')" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="`${t.moveDown}: ${category.name}`" :title="t.moveDown" :disabled="busy || index === tree.length - 1" @click="move(category, 'down')" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-folder-plus" :aria-label="t.addSubIn(category.name)" :title="t.addSub" :disabled="busy" @click="startSub(category)" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="`${t.rename}: ${category.name}`" :title="t.rename" :disabled="busy" @click="startEdit(category)" />
                <UButton
                  size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${de.common.delete}: ${category.name}`"
                  :title="deleteTitle(category, subcategories.length)" :disabled="busy || category.templateCount > 0 || subcategories.length > 0"
                  @click="remove(category)"
                />
              </div>
            </div>
            <ul v-if="subcategories.length" class="border-t border-gray-100 bg-gray-50/60">
              <li v-for="(sub, subIndex) in subcategories" :key="sub.id" class="flex flex-wrap items-center gap-2 py-1.5 pl-8 pr-3">
                <UIcon name="i-lucide-corner-down-right" class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
                <div class="min-w-32 flex-1">
                  <span class="font-medium">{{ sub.name }}</span>
                  <span class="block text-xs text-gray-500">{{ t.templateCount(sub.templateCount) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-1">
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="`${t.moveUp}: ${sub.name}`" :title="t.moveUp" :disabled="busy || subIndex === 0" @click="move(sub, 'up')" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="`${t.moveDown}: ${sub.name}`" :title="t.moveDown" :disabled="busy || subIndex === subcategories.length - 1" @click="move(sub, 'down')" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="`${t.rename}: ${sub.name}`" :title="t.rename" :disabled="busy" @click="startEdit(sub)" />
                  <UButton
                    size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${de.common.delete}: ${sub.name}`"
                    :title="deleteTitle(sub, 0)" :disabled="busy || sub.templateCount > 0" @click="remove(sub)"
                  />
                </div>
              </li>
            </ul>
          </li>
        </ul>

        <form class="grid gap-3 rounded-md bg-gray-50 p-3" @submit.prevent="save">
          <h3 class="text-sm font-semibold">{{ formTitle }}</h3>
          <UFormField :label="t.name" required>
            <UInput ref="nameInput" v-model="name" maxlength="60" class="w-full" required />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="editingId === null ? (parent ? t.addSub : t.add) : de.common.save" :loading="busy" :disabled="busy" />
            <UButton v-if="editingId !== null || parent" type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="startNew" />
          </div>
        </form>
      </div>
    </template>
  </UModal>
</template>
