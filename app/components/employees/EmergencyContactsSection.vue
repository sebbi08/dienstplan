<script setup lang="ts">
import type { EmergencyContactDto, EmergencyContactInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { telHref } from '~/utils/children'

/**
 * The employee's emergency contacts (tab „Stammdaten“), for Leitung and Träger: add, change, delete and re-order; the
 * first contact is called first. The same pattern as the child contacts (ChildContactsSection).
 */
const props = defineProps<{ employeeId: number }>()
const { data: contacts, error, refresh } = await useFetch<EmergencyContactDto[]>(`/api/employees/${props.employeeId}/emergency-contacts`)
// One request at a time: no double submit, and moves cannot race each other (the next one waits for the reloaded order).
const { busy, run } = useBusyAction(() => refresh())
const confirm = useConfirm()
// A 404 (employee not found) is the page's own business; any other failure is shown instead of hiding the section.
const loadError = computed(() => (error.value && (error.value as { statusCode?: number }).statusCode !== 404 ? errorMessage(error.value) : null))

const open = ref(false)
const editingId = ref<number | null>(null)
const emptyForm = (): EmergencyContactInput => ({ name: '', relation: '', phone: '', phone2: '', note: '' })
const form = reactive(emptyForm())

function openNew() {
  editingId.value = null
  Object.assign(form, emptyForm())
  open.value = true
}
function openEdit(contact: EmergencyContactDto) {
  editingId.value = contact.id
  Object.assign(form, { name: contact.name, relation: contact.relation, phone: contact.phone, phone2: contact.phone2, note: contact.note })
  open.value = true
}

async function save() {
  const body = { ...form }
  const request = editingId.value === null
    ? () => $fetch<unknown>(`/api/employees/${props.employeeId}/emergency-contacts`, { method: 'POST', body })
    : () => $fetch<unknown>(`/api/employee-emergency-contacts/${editingId.value}`, { method: 'PUT', body })
  if (await run(request, de.common.saved)) open.value = false
}

async function remove(contact: EmergencyContactDto) {
  if (await confirm(de.emergencyContacts.confirmDelete)) {
    run(() => $fetch<unknown>(`/api/employee-emergency-contacts/${contact.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}

function move(index: number, delta: -1 | 1) {
  const ids = (contacts.value ?? []).map(contact => contact.id)
  const [id] = ids.splice(index, 1)
  ids.splice(index + delta, 0, id!)
  run(() => $fetch<unknown>(`/api/employees/${props.employeeId}/emergency-contacts/order`, { method: 'POST', body: { ids } }))
}

const t = de.emergencyContacts
const phones = (contact: EmergencyContactDto) => [
  { label: t.fields.phone, number: contact.phone },
  { label: t.fields.phone2, number: contact.phone2 },
].filter(phone => phone.number !== '')
</script>

<template>
  <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
  <section v-else class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ t.title }}</h2>
      <div class="ml-auto flex flex-wrap gap-2">
        <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-printer" :label="t.print" to="/admin/print/emergency-contacts" target="_blank" />
        <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-plus" :label="t.add" @click="openNew" />
      </div>
    </div>
    <p class="text-sm text-gray-500">{{ t.hint }}</p>

    <p v-if="!contacts?.length" class="text-sm text-gray-500">{{ t.none }}</p>
    <ol v-else class="divide-y divide-gray-100">
      <li v-for="(contact, index) in contacts" :key="contact.id" class="flex flex-wrap items-start gap-3 py-3 text-sm">
        <span class="w-6 shrink-0 pt-0.5 font-semibold text-gray-500">{{ t.order(index + 1) }}</span>
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-medium">{{ contact.name }}</span>
            <span v-if="contact.relation" class="text-gray-600">({{ contact.relation }})</span>
            <span v-if="index === 0" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{{ t.callFirst }}</span>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <a v-for="phone in phones(contact)" :key="phone.label" :href="telHref(phone.number)" class="text-sky-700 hover:underline">
              <span class="text-xs text-gray-500">{{ phone.label }}:</span> {{ phone.number }}
            </a>
          </div>
          <p v-if="contact.note" class="whitespace-pre-line text-gray-600">{{ contact.note }}</p>
        </div>
        <div class="flex items-center">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="t.moveUp" :disabled="busy || index === 0" @click="move(index, -1)" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="t.moveDown" :disabled="busy || index === contacts.length - 1" @click="move(index, 1)" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" :disabled="busy" @click="openEdit(contact)" />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(contact)" />
        </div>
      </li>
    </ol>

    <UModal v-model:open="open" :title="editingId === null ? t.add : t.edit">
      <template #body>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
          <UFormField :label="t.fields.name" required><UInput v-model="form.name" maxlength="100" class="w-full" required autofocus /></UFormField>
          <UFormField :label="t.fields.relation">
            <UInput v-model="form.relation" maxlength="100" list="emergency-relations" class="w-full" />
            <datalist id="emergency-relations"><option v-for="relation in t.relations" :key="relation" :value="relation" /></datalist>
          </UFormField>
          <UFormField :label="t.fields.phone" required><UInput v-model="form.phone" type="tel" maxlength="50" class="w-full" required /></UFormField>
          <UFormField :label="t.fields.phone2"><UInput v-model="form.phone2" type="tel" maxlength="50" class="w-full" /></UFormField>
          <UFormField :label="t.fields.note" class="sm:col-span-2">
            <UTextarea v-model="form.note" :rows="2" maxlength="500" :placeholder="t.notePlaceholder" class="w-full" />
          </UFormField>
          <div class="flex gap-2 sm:col-span-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
