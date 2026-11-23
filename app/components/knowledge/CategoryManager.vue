<script setup lang="ts">
import { KNOWLEDGE_LIMITS } from '#shared/domain/knowledge'
import { TEMPLATE_VISIBILITIES, visibleTemplateLevels, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { KnowledgeCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { subcategoriesOf, topCategories } from '~/utils/subcategories'

/**
 * „Kategorien verwalten“ on „Dokumente“ → „Wissen“ (knowledge.manage), for the active facility: create, rename, reorder,
 * change who sees a category, delete an empty one (entries for all facilities filed by its name do not count; they move
 * to „Vom Träger“). Each category can have subcategories (one level), shown indented below it: „Unterkategorie anlegen“
 * at the category, then rename, reorder within the category, „Wer sieht sie?“ (on top of the category's) and delete
 * when empty. A category with subcategories cannot be deleted. The list holds only the categories the editor sees, and
 * only the visibilities the editor sees are offered (the Leitung not „nur Träger“; the server refuses it as well).
 */
const props = defineProps<{ categories: KnowledgeCategoryDto[]; refresh: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { required: true })

const { user } = useUserSession()
const { busy, run } = useBusyAction(props.refresh)
const confirm = useConfirm()
const t = de.knowledge.categories

const levels = computed(() => (user.value ? visibleTemplateLevels(user.value.role) : []))
const visibilityItems = computed(() => TEMPLATE_VISIBILITIES.filter(level => levels.value.includes(level))
  .map(level => ({ label: t.visibilities[level], value: level })))

/** Each category with its subcategories, in their order. */
const tree = computed(() => topCategories(props.categories).map(category => ({ category, subcategories: subcategoriesOf(props.categories, category.id) })))

/** null = a new (sub)category, otherwise the one being changed; `parent` = the category a new subcategory goes into. */
const editingId = ref<number | null>(null)
const parent = ref<KnowledgeCategoryDto | null>(null)
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
function startSub(category: KnowledgeCategoryDto) {
  editingId.value = null
  parent.value = category
  Object.assign(form, { name: '', visibility: 'all' })
  nextTick(() => nameInput.value?.inputRef?.focus())
}
function startEdit(category: KnowledgeCategoryDto) {
  editingId.value = category.id
  parent.value = null
  Object.assign(form, { name: category.name, visibility: category.visibility })
  nextTick(() => nameInput.value?.inputRef?.focus())
}
watch(open, (isOpen) => { if (isOpen) startNew() })

async function save() {
  const id = editingId.value
  const body = { name: form.name, visibility: form.visibility, ...(id === null && parent.value ? { parentId: parent.value.id } : {}) }
  const saved = await run(() => (id === null
    ? $fetch<{ id: number }>('/api/knowledge-categories', { method: 'POST', body })
    : $fetch<{ ok: boolean }>(`/api/knowledge-categories/${id}`, { method: 'PUT', body })), de.common.saved)
  if (saved) startNew()
}

function move(category: KnowledgeCategoryDto, direction: 'up' | 'down') {
  run(() => $fetch<{ ok: boolean }>(`/api/knowledge-categories/${category.id}/move`, { method: 'POST', body: { direction } }))
}

async function remove(category: KnowledgeCategoryDto) {
  if (await confirm(category.parentId === null ? t.confirmDelete(category.name) : t.confirmDeleteSub(category.name))) {
    const deleted = await run(() => $fetch<{ ok: boolean }>(`/api/knowledge-categories/${category.id}`, { method: 'DELETE' }), de.common.deleted)
    if (deleted && editingId.value === category.id) startNew()
  }
}

/** Why a category cannot be deleted (it holds own entries or subcategories), else the button's own label. */
const deleteTitle = (category: KnowledgeCategoryDto, subcategories: number) => (category.ownCount > 0
  ? de.errors.knowledge_category_not_empty
  : subcategories > 0 ? de.errors.knowledge_category_has_subcategories : de.common.delete)
</script>

<template>
  <UModal v-model:open="open" :title="de.knowledge.manageCategories">
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
                  {{ t.visibilities[category.visibility] }}<template v-if="category.entryCount > 0"> · {{ t.entryCount(category.entryCount) }}</template><template v-if="subcategories.length > 0"> · {{ t.subcategoryCount(subcategories.length) }}</template>
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-1">
                <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-up" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveUp}: ${category.name}`" :title="t.moveUp" :disabled="busy || index === 0" @click="move(category, 'up')" />
                <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-down" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveDown}: ${category.name}`" :title="t.moveDown" :disabled="busy || index === tree.length - 1" @click="move(category, 'down')" />
                <UButton color="neutral" variant="ghost" icon="i-lucide-folder-plus" class="min-h-10 min-w-10 justify-center" :aria-label="t.addSubIn(category.name)" :title="t.addSub" :disabled="busy" @click="startSub(category)" />
                <UButton color="neutral" variant="ghost" icon="i-lucide-pencil" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.edit}: ${category.name}`" :title="de.common.edit" :disabled="busy" @click="startEdit(category)" />
                <UButton
                  color="error" variant="ghost" icon="i-lucide-trash-2" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.delete}: ${category.name}`"
                  :title="deleteTitle(category, subcategories.length)"
                  :disabled="busy || category.ownCount > 0 || subcategories.length > 0" @click="remove(category)"
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
                    {{ t.visibilities[sub.visibility] }}<template v-if="sub.entryCount > 0"> · {{ t.entryCount(sub.entryCount) }}</template>
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-1">
                  <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-up" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveUp}: ${sub.name}`" :title="t.moveUp" :disabled="busy || subIndex === 0" @click="move(sub, 'up')" />
                  <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-down" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveDown}: ${sub.name}`" :title="t.moveDown" :disabled="busy || subIndex === subcategories.length - 1" @click="move(sub, 'down')" />
                  <UButton color="neutral" variant="ghost" icon="i-lucide-pencil" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.edit}: ${sub.name}`" :title="de.common.edit" :disabled="busy" @click="startEdit(sub)" />
                  <UButton
                    color="error" variant="ghost" icon="i-lucide-trash-2" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.delete}: ${sub.name}`"
                    :title="deleteTitle(sub, 0)" :disabled="busy || sub.ownCount > 0" @click="remove(sub)"
                  />
                </div>
              </li>
            </ul>
          </li>
        </ul>

        <form class="grid gap-3 rounded-md bg-gray-50 p-3" @submit.prevent="save">
          <h3 class="text-sm font-semibold">{{ formTitle }}</h3>
          <UFormField :label="editingSub ? t.subName : t.name" required>
            <UInput ref="nameInput" v-model="form.name" :maxlength="KNOWLEDGE_LIMITS.categoryName" class="w-full" required />
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
