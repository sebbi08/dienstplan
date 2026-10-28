<script setup lang="ts">
import type { TemplateVisibility } from '#shared/domain/templateCategories'
import type { TemplateCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { hiddenByVisibility } from '~/utils/printTemplates'

/**
 * „Kategorien verwalten“ on the templates page (whoever may edit templates): create, rename, reorder, change who sees a
 * category, delete an empty one. The list holds only the categories the editor sees, and only the visibilities the
 * editor sees are offered (`levels`: a Mitarbeiter only „alle“, the Leitung not „nur Träger“; the server refuses them
 * as well).
 */
const props = defineProps<{ categories: TemplateCategoryDto[]; levels: TemplateVisibility[]; refresh: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { required: true })

const { busy, run } = useBusyAction(props.refresh)
const confirm = useConfirm()
const t = de.printTemplates.categories

const visibilityItems = computed(() => props.levels
  .map(visibility => ({ label: t.visibilities[visibility], value: visibility })))

/** null = a new category, otherwise the one being changed. */
const editingId = ref<number | null>(null)
const form = reactive<{ name: string; visibility: TemplateVisibility }>({ name: '', visibility: 'all' })

function startNew() {
  editingId.value = null
  Object.assign(form, { name: '', visibility: 'all' })
}

function startEdit(category: TemplateCategoryDto) {
  editingId.value = category.id
  Object.assign(form, { name: category.name, visibility: category.visibility })
}

watch(open, (isOpen) => {
  if (isOpen) startNew()
})

async function save() {
  const id = editingId.value
  const body = { name: form.name, visibility: form.visibility }
  // Making a category with templates the Träger's alone hides them from Leitung, Mitarbeiter and the tablet: ask first.
  const current = props.categories.find(category => category.id === id)
  const hidden = current ? hiddenByVisibility(current, form.visibility) : 0
  if (hidden > 0 && !(await confirm(t.confirmProviderOnly(current!.name, hidden)))) return
  const saved = await run(() => (id === null
    ? $fetch<unknown>('/api/template-categories', { method: 'POST', body })
    : $fetch<unknown>(`/api/template-categories/${id}`, { method: 'PUT', body })), de.common.saved)
  if (saved) startNew()
}

function move(category: TemplateCategoryDto, direction: 'up' | 'down') {
  run(() => $fetch<unknown>(`/api/template-categories/${category.id}/move`, { method: 'POST', body: { direction } }))
}

async function remove(category: TemplateCategoryDto) {
  if (await confirm(t.confirmDelete(category.name))) {
    const deleted = await run(() => $fetch<unknown>(`/api/template-categories/${category.id}`, { method: 'DELETE' }), de.common.deleted)
    if (deleted && editingId.value === category.id) startNew()
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="de.printTemplates.manageCategories">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-gray-600">{{ t.intro }}</p>
        <p v-if="!categories.length" class="text-sm text-gray-500">{{ t.none }}</p>
        <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
          <li v-for="(category, index) in categories" :key="category.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <div class="min-w-40 flex-1">
              <span class="font-medium">{{ category.name }}</span>
              <span class="block text-xs text-gray-500">
                {{ t.visibilities[category.visibility] }}<template v-if="category.templateCount > 0"> · {{ t.templateCount(category.templateCount) }}</template>
              </span>
            </div>
            <div class="flex items-center gap-1">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="t.moveUp" :title="t.moveUp" :disabled="busy || index === 0" @click="move(category, 'up')" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="t.moveDown" :title="t.moveDown" :disabled="busy || index === categories.length - 1" @click="move(category, 'down')" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" :title="de.common.edit" :disabled="busy" @click="startEdit(category)" />
              <UButton
                size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete"
                :title="category.templateCount > 0 ? de.errors.template_category_not_empty : de.common.delete"
                :disabled="busy || category.templateCount > 0"
                @click="remove(category)"
              />
            </div>
          </li>
        </ul>

        <form class="grid gap-3 rounded-md bg-gray-50 p-3" @submit.prevent="save">
          <h3 class="text-sm font-semibold">{{ editingId === null ? t.add : t.edit }}</h3>
          <UFormField :label="t.name" required>
            <UInput v-model="form.name" maxlength="60" class="w-full" required />
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
