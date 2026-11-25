<script setup lang="ts">
import { CONTACT_LIMITS, comparableContactName, contactLevels, contactViewLevel } from '#shared/domain/contacts'
import { TEMPLATE_VISIBILITIES, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { ContactCategoryDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Kategorien verwalten“ on „Kontakte“ (contacts.manage), for the active facility, laid out like the ones of „Zum
 * Ausdrucken“ and „Wissen“: create, rename, reorder, change who sees a category („Wer sieht sie?“), delete an empty one
 * (contacts for all facilities filed by its name do not count, they move to „Vom Träger“ – renaming or deleting asks
 * first while there are any, as there they count with their own „Wer sieht ihn?“). The list holds only the
 * categories the editor sees, and only the visibilities the editor sees are offered (the Leitung not „Nur Träger“; the
 * server refuses it as well).
 */
const props = defineProps<{ categories: ContactCategoryDto[]; refresh: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { required: true })

const { user } = useUserSession()
const { busy, run } = useBusyAction(props.refresh)
const confirm = useConfirm()
const t = de.contacts.categories

// Whoever opens this maintains the address book (contacts.manage).
const levels = computed(() => (user.value ? contactLevels(contactViewLevel(user.value.role, true)) : []))
const visibilityItems = computed(() => TEMPLATE_VISIBILITIES.filter(level => levels.value.includes(level))
  .map(level => ({ label: t.visibilities[level], value: level })))

/** null = a new category, otherwise the one being changed. */
const editingId = ref<number | null>(null)
const form = reactive<{ name: string; visibility: TemplateVisibility }>({ name: '', visibility: 'all' })
const nameInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('nameInput')

function startNew() {
  editingId.value = null
  Object.assign(form, { name: '', visibility: 'all' })
}

function startEdit(category: ContactCategoryDto) {
  editingId.value = category.id
  Object.assign(form, { name: category.name, visibility: category.visibility })
  nextTick(() => nameInput.value?.inputRef?.focus())
}

watch(open, (isOpen) => {
  if (isOpen) startNew()
})

/** The Träger's contacts for several facilities shown in the category by its name (the ones not of this facility). */
const globalCount = (category: ContactCategoryDto) => Math.max(0, category.contactCount - category.ownCount)

async function save() {
  const id = editingId.value
  const current = props.categories.find(category => category.id === id)
  // Its contacts then vanish for Leitung, staff and tablet: ask first.
  if (current && current.visibility !== 'provider' && form.visibility === 'provider' && current.contactCount > 0
    && !(await confirm(t.confirmProviderOnly(current.name, current.contactCount)))) return
  // The Träger's contacts filed by the old name then show under „Vom Träger“, with their own „Wer sieht ihn?“: ask first.
  const moved = current ? globalCount(current) : 0
  if (current && moved > 0 && comparableContactName(form.name) !== comparableContactName(current.name)
    && !(await confirm(t.confirmRename(current.name, moved)))) return
  const body = { name: form.name, visibility: form.visibility }
  const saved = await run(() => (id === null
    ? $fetch<{ id: number }>('/api/contact-categories', { method: 'POST', body })
    : $fetch<{ ok: boolean }>(`/api/contact-categories/${id}`, { method: 'PUT', body })), de.common.saved)
  if (saved) startNew()
}

function move(category: ContactCategoryDto, direction: 'up' | 'down') {
  run(() => $fetch<{ ok: boolean }>(`/api/contact-categories/${category.id}/move`, { method: 'POST', body: { direction } }))
}

async function remove(category: ContactCategoryDto) {
  if (await confirm(t.confirmDelete(category.name, globalCount(category)), { danger: true })) {
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
              <span class="block text-xs text-gray-500">
                {{ t.visibilities[category.visibility] }}<template v-if="category.contactCount > 0"> · {{ t.contactCount(category.contactCount) }}</template>
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-1">
              <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-up" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveUp}: ${category.name}`" :title="t.moveUp" :disabled="busy || index === 0" @click="move(category, 'up')" />
              <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-down" class="min-h-10 min-w-10 justify-center" :aria-label="`${t.moveDown}: ${category.name}`" :title="t.moveDown" :disabled="busy || index === categories.length - 1" @click="move(category, 'down')" />
              <UButton color="neutral" variant="ghost" icon="i-lucide-pencil" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.edit}: ${category.name}`" :title="de.common.edit" :disabled="busy" @click="startEdit(category)" />
              <UButton
                color="error" variant="ghost" icon="i-lucide-trash-2" class="min-h-10 min-w-10 justify-center" :aria-label="`${de.common.delete}: ${category.name}`"
                :title="category.ownCount > 0 ? de.errors.contact_category_not_empty : de.common.delete"
                :disabled="busy || category.ownCount > 0" @click="remove(category)"
              />
            </div>
          </li>
        </ul>

        <form class="grid gap-3 rounded-md bg-gray-50 p-3" @submit.prevent="save">
          <h3 class="text-sm font-semibold">{{ editingId === null ? t.add : t.edit }}</h3>
          <UFormField :label="t.name" required>
            <UInput ref="nameInput" v-model="form.name" :maxlength="CONTACT_LIMITS.categoryName" class="w-full" required />
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
