<script setup lang="ts">
import { CONTACT_LIMITS } from '#shared/domain/contacts'
import type { ContactCategoryDto, ContactDto, ContactInput, DocumentTargetOptionsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import {
  asksForCategories, emptyTargets, facilitiesLost, targetsFormOf, targetsNeedChoice, targetsPayload, targetsProblem, type TargetsForm,
} from '~/utils/documentTargets'

/**
 * Creating or changing a contact (contacts.manage): a contact of the active facility in one of its categories, or, for
 * the Träger (contacts.global), one for all or the chosen facilities filed under a category name (with the names the
 * facilities use as suggestions). „Gilt für“ (shared/domain/documentTargets.ts: facilities for the Träger, groups also
 * for the Leitung) at creation and afterwards; it is sent only when changed, and saving waits for its choices.
 * „Wer sieht ihn?“: all, or only Leitung and Träger – on top of the category's „Wer sieht sie?“ (the stricter wins).
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
const confirm = useConfirm()
const adoptCategory = useCategoryAdopt('contacts')
const toast = useToast()

type Form = Omit<ContactInput, 'categoryId' | 'scope' | 'facilityIds' | 'groupTargets'> & {
  targets: TargetsForm; categoryId: number | undefined; categoryName: string
}
const empty = (): Form => ({
  targets: emptyTargets(), categoryId: undefined, categoryName: '', organisation: '', person: '', role: '', phone: '', mobile: '',
  email: '', street: '', postalCode: '', city: '', website: '', note: '', visibleToStaff: false,
})
const form = reactive<Form>(empty())

/** For all or the chosen facilities (the Träger's): filed by category name. */
const forAll = computed(() => form.targets.scope !== 'facility')
const categoryItems = computed(() => props.categories.map(category => ({ label: category.name, value: category.id })))
const visibilityItems = (['all', 'managers'] as const).map(level => ({ label: t.visibilities[level], value: level }))

// What „Gilt für“ offers, loaded with the form; saving waits for it, a failed load offers to try again. Sent only when
// the editor changed it (or must: no facility left), otherwise the server keeps it as it is.
const targetOptions = ref<DocumentTargetOptionsDto | null>(null)
const targetsFailed = ref(false)
const targetsTouched = ref(false)
async function loadTargetOptions() {
  targetsFailed.value = false
  try {
    targetOptions.value = await $fetch<DocumentTargetOptionsDto>('/api/contacts/targets')
  }
  catch {
    targetsFailed.value = true
  }
}

// The category names the facilities use, loaded when the Träger first files a contact for all or the chosen facilities.
const categoryNames = ref<string[]>([])
async function loadCategoryNames() {
  if (!props.canManageGlobal || categoryNames.value.length) return
  categoryNames.value = await $fetch<string[]>('/api/contact-categories/names').catch(() => [])
}
watch(forAll, (value) => { if (value && open.value) loadCategoryNames() })

watch(open, (isOpen) => {
  if (!isOpen) return
  loadTargetOptions()
  const contact = props.contact
  if (contact) {
    const {
      id: _id, categoryId, global, allFacilities: _all, globalCategoryName, updatedAt: _at, updatedBy: _by, canEdit: _edit, targets, ...fields
    } = contact
    // Turned into one for several facilities, it is filed by the name of its category (preselected).
    const categoryName = globalCategoryName ?? props.categories.find(category => category.id === categoryId)?.name ?? ''
    Object.assign(form, { ...fields, targets: targetsFormOf(targets), categoryId: categoryId ?? undefined, categoryName })
    targetsTouched.value = targetsNeedChoice(targets)
    if (global) loadCategoryNames()
  }
  else {
    const preset = props.presetCategoryId ?? (props.categories.length === 1 ? props.categories[0]!.id : undefined)
    Object.assign(form, { ...empty(), categoryId: preset, categoryName: props.categories.find(category => category.id === preset)?.name ?? '' })
    targetsTouched.value = false
  }
}, { immediate: true })

async function save() {
  if (!targetOptions.value) return
  const ownFacilityId = targetOptions.value.facilityId
  const problem = targetsTouched.value ? targetsProblem(form.targets, targetOptions.value, ownFacilityId) : null
  if (problem) return void toast.add({ title: problem.kind === 'facility' ? de.documentTargets.pickFacility : de.documentTargets.pickGroup(problem.facility), color: 'error' })
  const lost = props.contact && targetsTouched.value ? facilitiesLost(props.contact.targets, form.targets, targetOptions.value, ownFacilityId) : 0
  if (lost > 0 && !(await confirm(de.documentTargets.confirmLosing(lost, 'der Kontakt')))) return
  // For several or all facilities: create the category where it is missing („Nein“: „Vom Träger“ there)?
  // A change asks only when „Gilt für“ or the category name changed (a „Nein“ is not asked again on every save).
  const asks = forAll.value && asksForCategories(props.contact ? { categoryName: props.contact.globalCategoryName } : null, form, targetsTouched.value)
  const createCategories = asks ? await adoptCategory(form.targets, form.categoryName) : undefined
  if (createCategories === null) return
  const { targets: _targets, categoryId, categoryName, ...fields } = form
  const body: ContactInput = {
    ...fields,
    ...(targetsTouched.value ? targetsPayload(form.targets, targetOptions.value, ownFacilityId) : {}),
    ...(forAll.value ? { categoryName } : { categoryId: categoryId ?? null }),
    ...(createCategories ? { createCategories: true } : {}),
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
        <!-- „Gilt für“: facilities (the Träger) and groups; afterwards too. -->
        <DocumentTargetsField
          v-model="form.targets" :options="targetOptions" :can-global="canManageGlobal" :facility-id="targetOptions?.facilityId ?? null"
          :facility-name="activeName ?? ''" id-prefix="contact-targets" class="sm:col-span-2" @update:model-value="targetsTouched = true"
        />
        <UAlert
          v-if="targetsFailed" color="warning" variant="soft" :title="de.documentTargets.loadFailed" class="sm:col-span-2"
          :actions="[{ label: de.documentTargets.retry, color: 'neutral', variant: 'outline', onClick: loadTargetOptions }]"
        />
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
        <!-- „Wer sieht ihn?“ (stored as „auch für Mitarbeitende“): on top of the category's „Wer sieht sie?“. -->
        <UFormField :label="t.visibility" :description="t.visibilityHint" class="sm:col-span-2">
          <USelect
            :model-value="form.visibleToStaff ? 'all' : 'managers'" :items="visibilityItems" class="w-full"
            @update:model-value="form.visibleToStaff = $event === 'all'"
          />
        </UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" :label="contact ? de.common.save : t.add" :loading="busy" :disabled="busy || !targetOptions" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
