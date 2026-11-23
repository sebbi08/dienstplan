<script setup lang="ts">
import { KNOWLEDGE_LIMITS } from '#shared/domain/knowledge'
import { TEMPLATE_VISIBILITIES, visibleTemplateLevels, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { KnowledgeCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Kategorien verwalten“ on „Dokumente“ → „Wissen“ (knowledge.manage), for the active facility: create, rename, reorder,
 * change who sees a category, delete an empty one (entries for all facilities filed by its name do not count; they move
 * to „Vom Träger“). The list holds only the categories the editor sees, and only the visibilities the editor sees are
 * offered (the Leitung not „nur Träger“; the server refuses it as well).
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

/** null = a new category, otherwise the one being changed. */
const editingId = ref<number | null>(null)
const form = reactive<{ name: string; visibility: TemplateVisibility }>({ name: '', visibility: 'all' })

function startNew() {
  editingId.value = null
  Object.assign(form, { name: '', visibility: 'all' })
}
function startEdit(category: KnowledgeCategoryDto) {
  editingId.value = category.id
  Object.assign(form, { name: category.name, visibility: category.visibility })
}
watch(open, (isOpen) => { if (isOpen) startNew() })

async function save() {
  const id = editingId.value
  const body = { name: form.name, visibility: form.visibility }
  const saved = await run(() => (id === null
    ? $fetch<{ id: number }>('/api/knowledge-categories', { method: 'POST', body })
    : $fetch<{ ok: boolean }>(`/api/knowledge-categories/${id}`, { method: 'PUT', body })), de.common.saved)
  if (saved) startNew()
}

function move(category: KnowledgeCategoryDto, direction: 'up' | 'down') {
  run(() => $fetch<{ ok: boolean }>(`/api/knowledge-categories/${category.id}/move`, { method: 'POST', body: { direction } }))
}

async function remove(category: KnowledgeCategoryDto) {
  if (await confirm(t.confirmDelete(category.name))) {
    const deleted = await run(() => $fetch<{ ok: boolean }>(`/api/knowledge-categories/${category.id}`, { method: 'DELETE' }), de.common.deleted)
    if (deleted && editingId.value === category.id) startNew()
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="de.knowledge.manageCategories">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-gray-600">{{ t.intro }}</p>
        <p v-if="!categories.length" class="text-sm text-gray-500">{{ t.none }}</p>
        <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
          <li v-for="(category, index) in categories" :key="category.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <div class="min-w-40 flex-1">
              <span class="font-medium">{{ category.name }}</span>
              <span class="block text-xs text-gray-500">
                {{ t.visibilities[category.visibility] }}<template v-if="category.entryCount > 0"> · {{ t.entryCount(category.entryCount) }}</template>
              </span>
            </div>
            <div class="flex items-center gap-1">
              <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-up" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveUp}: ${category.name}`" :title="t.moveUp" :disabled="busy || index === 0" @click="move(category, 'up')" />
              <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-down" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveDown}: ${category.name}`" :title="t.moveDown" :disabled="busy || index === categories.length - 1" @click="move(category, 'down')" />
              <UButton color="neutral" variant="ghost" icon="i-lucide-pencil" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.edit}: ${category.name}`" :title="de.common.edit" :disabled="busy" @click="startEdit(category)" />
              <UButton
                color="error" variant="ghost" icon="i-lucide-trash-2" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.delete}: ${category.name}`"
                :title="category.ownCount > 0 ? de.errors.knowledge_category_not_empty : de.common.delete"
                :disabled="busy || category.ownCount > 0" @click="remove(category)"
              />
            </div>
          </li>
        </ul>

        <form class="grid gap-3 rounded-md bg-gray-50 p-3" @submit.prevent="save">
          <h3 class="text-sm font-semibold">{{ editingId === null ? t.add : t.edit }}</h3>
          <UFormField :label="t.name" required>
            <UInput v-model="form.name" :maxlength="KNOWLEDGE_LIMITS.categoryName" class="w-full" required />
          </UFormField>
          <UFormField :label="t.visibility">
            <USelect v-model="form.visibility" :items="visibilityItems" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="editingId === null ? t.add : de.common.save" :loading="busy" :disabled="busy" />
            <UButton v-if="editingId !== null" type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="startNew" />
          </div>
        </form>
      </div>
    </template>
  </UModal>
</template>
