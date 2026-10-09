<script setup lang="ts">
import type { ChildContactDto, ChildContactInput, ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { phonesOf, telHref } from '~/utils/children'

/** Contact persons (Bezugspersonen): add, change, delete and re-order (the order is kept, emergency ranks are separate). */
const props = defineProps<{ child: ChildRecordDto }>()
const emit = defineEmits<{ saved: [] }>()
// One request at a time: no double submit, and moves cannot race each other.
const { busy, run } = useBusyAction(async () => emit('saved'))
const confirm = useConfirm()

const open = ref(false)
const editingId = ref<number | null>(null)
const emptyForm = () => ({
  name: '', relation: '', phoneHome: '', phoneMobile: '', phoneWork: '', isGuardian: false, mayPickUp: false,
  emergencyRank: '', contactBan: false, contactBanNote: '', note: '',
})
const form = reactive(emptyForm())

function openNew() {
  editingId.value = null
  Object.assign(form, emptyForm())
  open.value = true
}
function openEdit(contact: ChildContactDto) {
  editingId.value = contact.id
  Object.assign(form, { ...contact, emergencyRank: String(contact.emergencyRank ?? '') })
  open.value = true
}

/** A ban excludes pick-up and emergency contact (the server refuses the combination). */
function onBan(banned: boolean) {
  form.contactBan = banned
  if (banned) {
    form.mayPickUp = false
    form.emergencyRank = ''
  }
}

function payload(): ChildContactInput {
  const rank = form.emergencyRank.trim()
  return {
    name: form.name, relation: form.relation, phoneHome: form.phoneHome, phoneMobile: form.phoneMobile, phoneWork: form.phoneWork,
    isGuardian: form.isGuardian, mayPickUp: form.mayPickUp, emergencyRank: rank === '' ? null : Number(rank),
    contactBan: form.contactBan, contactBanNote: form.contactBan ? form.contactBanNote : '', note: form.note,
  }
}

async function save() {
  const request = editingId.value === null
    ? () => $fetch<unknown>(`/api/children/${props.child.id}/contacts`, { method: 'POST', body: payload() })
    : () => $fetch<unknown>(`/api/child-contacts/${editingId.value}`, { method: 'PUT', body: payload() })
  if (await run(request, de.common.saved)) open.value = false
}

async function remove(contact: ChildContactDto) {
  if (await confirm(de.children.confirmDeleteContact)) run(() => $fetch<unknown>(`/api/child-contacts/${contact.id}`, { method: 'DELETE' }), de.common.deleted)
}

function move(index: number, delta: -1 | 1) {
  const ids = props.child.contacts.map(contact => contact.id)
  const [id] = ids.splice(index, 1)
  ids.splice(index + delta, 0, id!)
  run(() => $fetch<unknown>(`/api/children/${props.child.id}/contacts/order`, { method: 'POST', body: { ids } }))
}

const f = de.children.fields
</script>

<template>
  <ChildrenChildSection :title="de.children.sections.contacts" :stamp="child.stamps.contacts" :can-edit="false">
    <template v-if="child.canEdit" #actions>
      <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-plus" :label="de.children.addContact" @click="openNew" />
    </template>

    <p v-if="!child.contacts.length" class="text-sm text-gray-500">{{ de.children.noContacts }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="(contact, index) in child.contacts" :key="contact.id" class="flex flex-wrap items-start gap-3 py-3 text-sm">
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-medium">{{ contact.name }}</span>
            <span v-if="contact.relation" class="text-gray-600">({{ contact.relation }})</span>
            <span v-if="contact.isGuardian" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{{ de.children.guardian }}</span>
            <span v-if="contact.mayPickUp" class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">{{ de.children.pickUp }}</span>
            <span v-if="contact.emergencyRank !== null" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{{ de.children.emergency(contact.emergencyRank) }}</span>
            <span v-if="contact.contactBan" class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">{{ de.children.contactBan }}</span>
          </div>
          <p v-if="contact.contactBan" class="font-medium text-red-700">{{ contact.contactBanNote }}</p>
          <div v-if="phonesOf(contact).length" class="flex flex-wrap gap-x-4 gap-y-1">
            <a v-for="phone in phonesOf(contact)" :key="phone.label" :href="telHref(phone.number)" class="text-sky-700 hover:underline">
              <span class="text-xs text-gray-500">{{ phone.label }}:</span> {{ phone.number }}
            </a>
          </div>
          <p v-if="contact.note" class="whitespace-pre-line text-gray-600">{{ contact.note }}</p>
        </div>
        <div v-if="child.canEdit" class="flex items-center">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.children.moveUp" :disabled="busy || index === 0" @click="move(index, -1)" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.children.moveDown" :disabled="busy || index === child.contacts.length - 1" @click="move(index, 1)" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" :disabled="busy" @click="openEdit(contact)" />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(contact)" />
        </div>
      </li>
    </ul>

    <UModal v-model:open="open" :title="editingId === null ? de.children.addContact : de.children.editContact">
      <template #body>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
          <UFormField :label="f.name" required><UInput v-model="form.name" maxlength="100" class="w-full" required autofocus /></UFormField>
          <UFormField :label="f.relation">
            <UInput v-model="form.relation" maxlength="100" list="child-relations" class="w-full" />
            <datalist id="child-relations"><option v-for="relation in de.children.relations" :key="relation" :value="relation" /></datalist>
          </UFormField>
          <UFormField :label="f.phoneMobile"><UInput v-model="form.phoneMobile" type="tel" maxlength="50" class="w-full" /></UFormField>
          <UFormField :label="f.phoneHome"><UInput v-model="form.phoneHome" type="tel" maxlength="50" class="w-full" /></UFormField>
          <UFormField :label="f.phoneWork"><UInput v-model="form.phoneWork" type="tel" maxlength="50" class="w-full" /></UFormField>
          <UFormField :label="f.emergencyRank">
            <UInput v-model="form.emergencyRank" type="number" min="1" max="20" step="1" :disabled="form.contactBan" class="w-full" />
          </UFormField>
          <div class="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
            <UCheckbox v-model="form.isGuardian" :label="f.isGuardian" />
            <UCheckbox v-model="form.mayPickUp" :label="f.mayPickUp" :disabled="form.contactBan" />
            <UCheckbox :model-value="form.contactBan" :label="de.children.contactBan" @update:model-value="onBan(!!$event)" />
          </div>
          <UFormField v-if="form.contactBan" :label="f.contactBanNote" class="sm:col-span-2" required>
            <UTextarea v-model="form.contactBanNote" :rows="2" maxlength="500" class="w-full" required />
          </UFormField>
          <UFormField :label="f.note" class="sm:col-span-2"><UTextarea v-model="form.note" :rows="2" maxlength="1000" class="w-full" /></UFormField>
          <div class="flex gap-2 sm:col-span-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>
  </ChildrenChildSection>
</template>
