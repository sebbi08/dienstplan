<script setup lang="ts">
import { CONTACT_LIMITS } from '#shared/domain/contacts'
import type { ContactCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Kategorien verwalten“ on „Kontakte“ (contacts.manage), for the active facility: add, rename, reorder, delete an empty
 * category (contacts for all facilities filed by its name do not count, they move to „Vom Träger“).
 */
const props = defineProps<{ categories: ContactCategoryDto[]; refresh: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { required: true })

const { busy, run } = useBusyAction(props.refresh)
const confirm = useConfirm()
const t = de.contacts.categories

/** null = a new category, otherwise the one being renamed. */
const editingId = ref<number | null>(null)
const name = ref('')

function startNew() {
  editingId.value = null
  name.value = ''
}

function startEdit(category: ContactCategoryDto) {
  editingId.value = category.id
  name.value = category.name
}

watch(open, (isOpen) => {
  if (isOpen) startNew()
})

async function save() {
  const id = editingId.value
  const body = { name: name.value }
  const saved = await run(() => (id === null
    ? $fetch<{ id: number }>('/api/contact-categories', { method: 'POST', body })
    : $fetch<{ ok: boolean }>(`/api/contact-categories/${id}`, { method: 'PUT', body })), de.common.saved)
  if (saved) startNew()
}

function move(category: ContactCategoryDto, direction: 'up' | 'down') {
  run(() => $fetch<{ ok: boolean }>(`/api/contact-categories/${category.id}/move`, { method: 'POST', body: { direction } }))
}

async function remove(category: ContactCategoryDto) {
  if (await confirm(t.confirmDelete(category.name), { danger: true })) {
    const deleted = await run(() => $fetch<{ ok: boolean }>(`/api/contact-categories/${category.id}`, { method: 'DELETE' }), de.common.deleted)
    if (deleted && editingId.value === category.id) startNew()
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="de.contacts.manageCategories">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-gray-600">{{ t.intro }}</p>
        <p v-if="!categories.length" class="text-sm text-gray-500">{{ t.none }}</p>
        <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
          <li v-for="(category, index) in categories" :key="category.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <div class="min-w-40 flex-1">
              <span class="font-medium">{{ category.name }}</span>
              <span v-if="category.contactCount > 0" class="block text-xs text-gray-500">{{ t.contactCount(category.contactCount) }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="`${t.up}: ${category.name}`" :title="t.up" :disabled="busy || index === 0" @click="move(category, 'up')" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="`${t.down}: ${category.name}`" :title="t.down" :disabled="busy || index === categories.length - 1" @click="move(category, 'down')" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="`${t.rename}: ${category.name}`" :title="t.rename" :disabled="busy" @click="startEdit(category)" />
              <UButton
                size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${de.common.delete}: ${category.name}`"
                :title="category.ownCount > 0 ? de.errors.contact_category_not_empty : de.common.delete"
                :disabled="busy || category.ownCount > 0" @click="remove(category)"
              />
            </div>
          </li>
        </ul>

        <form class="grid gap-3 rounded-md bg-gray-50 p-3" @submit.prevent="save">
          <h3 class="text-sm font-semibold">{{ editingId === null ? t.add : t.rename }}</h3>
          <UFormField :label="t.name" required>
            <UInput v-model="name" :maxlength="CONTACT_LIMITS.categoryName" class="w-full" required />
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
