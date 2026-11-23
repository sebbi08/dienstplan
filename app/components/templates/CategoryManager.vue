<script setup lang="ts">
import type { TemplateVisibility } from '#shared/domain/templateCategories'
import type { TemplateCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { hiddenByVisibility, movedToProvider } from '~/utils/printTemplates'
import { subcategoriesOf, topCategories } from '~/utils/subcategories'

/**
 * „Kategorien verwalten“ on „Dokumente“ → „Vorlagen“ (whoever may edit templates), for the active facility: create,
 * rename, reorder, change who sees a category, delete an empty one (templates for all facilities filed by its name do
 * not count, but deleting or renaming names them: they move to „Vom Träger“). Each category can have subcategories (one
 * level), shown indented below it: „Unterkategorie anlegen“ at the category, then rename, reorder within the category,
 * „Wer sieht sie?“ (on top of the category's) and delete when empty. A category with subcategories cannot be deleted.
 * The list holds only the categories the editor sees, and only the visibilities the editor sees are offered (`levels`:
 * a Mitarbeiter only „alle“, the Leitung not „nur Träger“; the server refuses them as well).
 */
const props = defineProps<{ categories: TemplateCategoryDto[]; levels: TemplateVisibility[]; refresh: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { required: true })

const { busy, run } = useBusyAction(props.refresh)
const confirm = useConfirm()
const t = de.printTemplates.categories

const visibilityItems = computed(() => props.levels
  .map(visibility => ({ label: t.visibilities[visibility], value: visibility })))

/** Each category with its subcategories, in their order. */
const tree = computed(() => topCategories(props.categories).map(category => ({ category, subcategories: subcategoriesOf(props.categories, category.id) })))

/** null = a new (sub)category, otherwise the one being changed; `parent` = the category a new subcategory goes into. */
const editingId = ref<number | null>(null)
const parent = ref<TemplateCategoryDto | null>(null)
const form = reactive<{ name: string; visibility: TemplateVisibility }>({ name: '', visibility: 'all' })
const editingSub = computed(() => parent.value !== null || props.categories.some(category => category.id === editingId.value && category.parentId !== null))
const formTitle = computed(() => {
  if (editingId.value !== null) return editingSub.value ? t.editSub : t.edit
  return parent.value ? t.addSubIn(parent.value.name) : t.add
})
const nameInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('nameInput')

function startNew() {
  editingId.value = null
  parent.value = null
  Object.assign(form, { name: '', visibility: 'all' })
}

function startSub(category: TemplateCategoryDto) {
  editingId.value = null
  parent.value = category
  Object.assign(form, { name: '', visibility: 'all' })
  nextTick(() => nameInput.value?.inputRef?.focus())
}

function startEdit(category: TemplateCategoryDto) {
  editingId.value = category.id
  parent.value = null
  Object.assign(form, { name: category.name, visibility: category.visibility })
  nextTick(() => nameInput.value?.inputRef?.focus())
}

watch(open, (isOpen) => {
  if (isOpen) startNew()
})

async function save() {
  const id = editingId.value
  const body = { name: form.name, visibility: form.visibility, ...(id === null && parent.value ? { parentId: parent.value.id } : {}) }
  // Making a category with templates the Träger's alone hides them from Leitung, Mitarbeiter and the tablet: ask first.
  const current = props.categories.find(category => category.id === id)
  const hidden = current ? hiddenByVisibility(current, form.visibility, props.categories) : { count: 0, global: 0 }
  if (hidden.count > 0 && !(await confirm(t.confirmProviderOnly(current!.name, hidden.count, hidden.global)))) return
  // A new name: the Träger's templates shown in it by the old name move to „Vom Träger“ (from a subcategory: into its category).
  const moved = current ? movedToProvider(current, form.name, props.categories) : 0
  if (moved > 0) {
    const question = current!.parentId === null ? t.confirmRename(current!.name, moved) : t.confirmRenameSub(current!.name, moved)
    if (!(await confirm(question, { confirmLabel: t.rename }))) return
  }
  const saved = await run(() => (id === null
    ? $fetch<{ id: number }>('/api/template-categories', { method: 'POST', body })
    : $fetch<{ ok: boolean }>(`/api/template-categories/${id}`, { method: 'PUT', body })), de.common.saved)
  if (saved) startNew()
}

function move(category: TemplateCategoryDto, direction: 'up' | 'down') {
  run(() => $fetch<{ ok: boolean }>(`/api/template-categories/${category.id}/move`, { method: 'POST', body: { direction } }))
}

async function remove(category: TemplateCategoryDto) {
  const moved = movedToProvider(category, null, props.categories)
  const question = category.parentId === null ? t.confirmDelete(category.name, moved) : t.confirmDeleteSub(category.name, moved)
  if (await confirm(question)) {
    const deleted = await run(() => $fetch<{ ok: boolean }>(`/api/template-categories/${category.id}`, { method: 'DELETE' }), de.common.deleted)
    if (deleted && editingId.value === category.id) startNew()
  }
}

/** Why a category cannot be deleted (it holds templates or subcategories), else the button's own label. */
const deleteTitle = (category: TemplateCategoryDto, subcategories: number) => (category.templateCount > 0
  ? de.errors.template_category_not_empty
  : subcategories > 0 ? de.errors.template_category_has_subcategories : de.common.delete)
</script>

<template>
  <UModal v-model:open="open" :title="de.printTemplates.manageCategories">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-gray-600">{{ t.intro }}</p>
        <p v-if="!categories.length" class="text-sm text-gray-500">{{ t.none }}</p>
        <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
          <li v-for="({ category, subcategories }, index) in tree" :key="category.id" class="text-sm">
            <div class="flex flex-wrap items-center gap-2 px-3 py-2">
              <div class="min-w-40 flex-1">
                <span class="font-medium">{{ category.name }}</span>
                <span class="block text-xs text-gray-500">
                  {{ t.visibilities[category.visibility] }}<template v-if="category.templateCount > 0"> · {{ t.templateCount(category.templateCount) }}</template><template v-if="category.globalCount > 0"> · {{ t.globalCount(category.globalCount) }}</template><template v-if="subcategories.length > 0"> · {{ t.subcategoryCount(subcategories.length) }}</template>
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-1">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="`${t.moveUp}: ${category.name}`" :title="t.moveUp" :disabled="busy || index === 0" @click="move(category, 'up')" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="`${t.moveDown}: ${category.name}`" :title="t.moveDown" :disabled="busy || index === tree.length - 1" @click="move(category, 'down')" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-folder-plus" :aria-label="t.addSubIn(category.name)" :title="t.addSub" :disabled="busy" @click="startSub(category)" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="`${de.common.edit}: ${category.name}`" :title="de.common.edit" :disabled="busy" @click="startEdit(category)" />
                <UButton
                  size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${de.common.delete}: ${category.name}`"
                  :title="deleteTitle(category, subcategories.length)"
                  :disabled="busy || category.templateCount > 0 || subcategories.length > 0"
                  @click="remove(category)"
                />
              </div>
            </div>
            <!-- The subcategories, indented below their category. -->
            <ul v-if="subcategories.length" class="border-t border-gray-100 bg-gray-50/60">
              <li v-for="(sub, subIndex) in subcategories" :key="sub.id" class="flex flex-wrap items-center gap-2 py-1.5 pl-8 pr-3">
                <UIcon name="i-lucide-corner-down-right" class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
                <div class="min-w-32 flex-1">
                  <span class="font-medium">{{ sub.name }}</span>
                  <span class="block text-xs text-gray-500">
                    {{ t.visibilities[sub.visibility] }}<template v-if="sub.templateCount > 0"> · {{ t.templateCount(sub.templateCount) }}</template><template v-if="sub.globalCount > 0"> · {{ t.globalCount(sub.globalCount) }}</template>
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-1">
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="`${t.moveUp}: ${sub.name}`" :title="t.moveUp" :disabled="busy || subIndex === 0" @click="move(sub, 'up')" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="`${t.moveDown}: ${sub.name}`" :title="t.moveDown" :disabled="busy || subIndex === subcategories.length - 1" @click="move(sub, 'down')" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="`${de.common.edit}: ${sub.name}`" :title="de.common.edit" :disabled="busy" @click="startEdit(sub)" />
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
            <UInput ref="nameInput" v-model="form.name" maxlength="60" class="w-full" required />
          </UFormField>
          <UFormField :label="t.visibility" :description="editingSub ? t.subVisibilityHint : undefined">
            <USelect v-model="form.visibility" :items="visibilityItems" class="w-full" />
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
