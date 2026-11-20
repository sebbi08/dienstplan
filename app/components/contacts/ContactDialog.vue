<script setup lang="ts">
import { CONTACT_LIMITS } from '#shared/domain/contacts'
import type { ContactCategoryDto, ContactDto, ContactInput, ContactScope } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Creating or changing a contact (contacts.manage): a contact of the active facility in one of its categories, or, for
 * the Träger (contacts.global), one for all facilities filed under a category name (with the names the facilities use
 * as suggestions). Where a contact is kept is chosen once, when it is created.
 */
const props = defineProps<{
  /** null = a new contact. */
  contact: ContactDto | null
  categories: ContactCategoryDto[]
  canManageGlobal: boolean
  /** The category a new contact starts in (the open sub-tab). */
  presetCategoryId: number | null
  refresh: () => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { required: true })

const t = de.contacts
const f = t.fields
const { activeName } = useFacilities()
const { busy, run } = useBusyAction(props.refresh)

type Form = Omit<ContactInput, 'categoryId' | 'scope'> & { scope: ContactScope; categoryId: number | undefined; categoryName: string }
const empty = (): Form => ({
  scope: 'facility', categoryId: undefined, categoryName: '', organisation: '', person: '', role: '', phone: '', mobile: '',
  email: '', street: '', postalCode: '', city: '', website: '', note: '', visibleToStaff: false,
})
const form = reactive<Form>(empty())

const forAll = computed(() => (props.contact ? props.contact.global : form.scope === 'all'))
const categoryItems = computed(() => props.categories.map(category => ({ label: category.name, value: category.id })))
const scopeItems = computed(() => [
  { label: activeName.value ? t.scopeFacility(activeName.value) : t.scopeThisFacility, value: 'facility' },
  { label: t.scopeAll, value: 'all' },
])

// The category names the facilities use, loaded when the Träger first files a contact for all facilities.
const categoryNames = ref<string[]>([])
async function loadCategoryNames() {
  if (!props.canManageGlobal || categoryNames.value.length) return
  categoryNames.value = await $fetch<string[]>('/api/contact-categories/names').catch(() => [])
}
watch(forAll, (value) => { if (value && open.value) loadCategoryNames() })

watch(open, (isOpen) => {
  if (!isOpen) return
  const contact = props.contact
  if (contact) {
    const { id: _id, categoryId, global, globalCategoryName, updatedAt: _at, updatedBy: _by, canEdit: _edit, ...fields } = contact
    Object.assign(form, { ...fields, scope: global ? 'all' : 'facility', categoryId: categoryId ?? undefined, categoryName: globalCategoryName ?? '' })
    if (global) loadCategoryNames()
  }
  else {
    const preset = props.presetCategoryId ?? (props.categories.length === 1 ? props.categories[0]!.id : undefined)
    Object.assign(form, { ...empty(), categoryId: preset, categoryName: props.categories.find(category => category.id === preset)?.name ?? '' })
  }
}, { immediate: true })

async function save() {
  const { scope, categoryId, categoryName, ...fields } = form
  const body: ContactInput = {
    ...fields,
    ...(props.contact ? {} : { scope }),
    ...(forAll.value ? { categoryName } : { categoryId: categoryId ?? null }),
  }
  const saved = await run(() => (props.contact
    ? $fetch<{ ok: boolean }>(`/api/contacts/${props.contact.id}`, { method: 'PUT', body })
    : $fetch<{ id: number }>('/api/contacts', { method: 'POST', body })), de.common.saved)
  if (saved) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="contact ? t.edit : t.add">
    <template #body>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
        <UFormField v-if="canManageGlobal && !contact" :label="f.scope" class="sm:col-span-2">
          <USelect v-model="form.scope" :items="scopeItems" class="w-full" />
        </UFormField>
        <UFormField v-if="forAll" :label="f.categoryName" :description="t.categoryNameHint" required class="sm:col-span-2">
          <UInput v-model="form.categoryName" :maxlength="CONTACT_LIMITS.categoryName" class="w-full" list="contact-category-names" required autocomplete="off" />
          <datalist id="contact-category-names">
            <option v-for="name in categoryNames" :key="name" :value="name" />
          </datalist>
        </UFormField>
        <UFormField v-else :label="f.category" required class="sm:col-span-2">
          <USelect v-model="form.categoryId" :items="categoryItems" :placeholder="t.categoryPlaceholder" class="w-full" required />
        </UFormField>
        <UFormField :label="f.organisation" required class="sm:col-span-2">
          <UInput v-model="form.organisation" :maxlength="CONTACT_LIMITS.organisation" :placeholder="t.organisationPlaceholder" class="w-full" required />
        </UFormField>
        <UFormField :label="f.person"><UInput v-model="form.person" :maxlength="CONTACT_LIMITS.person" class="w-full" /></UFormField>
        <UFormField :label="f.role"><UInput v-model="form.role" :maxlength="CONTACT_LIMITS.role" :placeholder="t.rolePlaceholder" class="w-full" /></UFormField>
        <UFormField :label="f.phone"><UInput v-model="form.phone" type="tel" :maxlength="CONTACT_LIMITS.phone" class="w-full" /></UFormField>
        <UFormField :label="f.mobile"><UInput v-model="form.mobile" type="tel" :maxlength="CONTACT_LIMITS.mobile" class="w-full" /></UFormField>
        <UFormField :label="f.email"><UInput v-model="form.email" type="email" :maxlength="CONTACT_LIMITS.email" class="w-full" /></UFormField>
        <UFormField :label="f.website"><UInput v-model="form.website" :maxlength="CONTACT_LIMITS.website" placeholder="https://" class="w-full" /></UFormField>
        <UFormField :label="f.street" class="sm:col-span-2"><UInput v-model="form.street" :maxlength="CONTACT_LIMITS.street" class="w-full" /></UFormField>
        <UFormField :label="f.postalCode"><UInput v-model="form.postalCode" :maxlength="CONTACT_LIMITS.postalCode" inputmode="numeric" class="w-full" /></UFormField>
        <UFormField :label="f.city"><UInput v-model="form.city" :maxlength="CONTACT_LIMITS.city" class="w-full" /></UFormField>
        <UFormField :label="f.note" class="sm:col-span-2">
          <UTextarea v-model="form.note" :rows="3" :maxlength="CONTACT_LIMITS.note" class="w-full" />
        </UFormField>
        <UFormField :description="t.visibleToStaffHint" class="sm:col-span-2">
          <UCheckbox v-model="form.visibleToStaff" :label="t.visibleToStaff" />
        </UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" :label="contact ? de.common.save : t.add" :loading="busy" :disabled="busy" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
