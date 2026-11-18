<script setup lang="ts">
import {
  addressLine, CONTACT_KINDS, CONTACT_OWNERS, MAX_CONTACT_ENTRIES, telHref, websiteHref, type FacilityContactDto,
  type FacilityContactEntry,
} from '#shared/domain/facilityContact'
import { de } from '~/locales/de'

/**
 * Kontakt of the facility (settings): address, website, Träger, Leitung, and phone numbers and e-mail addresses, each
 * belonging to the Einrichtung, the Leitung or the Träger. The Träger edits it (for the facility chosen in „Einstellungen
 * für“); the Leitung sees it read-only, with tel: and mailto: links.
 */
const { data, refresh } = await useFetch<FacilityContactDto>('/api/facility-contact', { key: 'facility-contact' })
const { can } = useCan()
const canEdit = computed(() => can('facilities.manage'))
const { busy, run } = useBusyAction(refresh)
const s = de.facilityContact

const blank = (): FacilityContactDto => ({ street: '', postalCode: '', city: '', website: '', operator: '', manager: '', contacts: [] })
const copy = (value: FacilityContactDto): FacilityContactDto => ({ ...value, contacts: value.contacts.map(entry => ({ ...entry })) })
const draft = ref<FacilityContactDto>(blank())
watch(data, (value) => {
  draft.value = value ? copy(value) : blank()
}, { immediate: true })

const kindItems = CONTACT_KINDS.map(value => ({ label: s.kinds[value], value }))
const ownerItems = CONTACT_OWNERS.map(value => ({ label: s.owners[value], value }))

const dirty = useDirty(() => canEdit.value && !!data.value && !sameValue(draft.value, data.value))

function add() {
  if (draft.value.contacts.length >= MAX_CONTACT_ENTRIES) return
  draft.value.contacts.push({ kind: 'phone', value: '', belongsTo: 'facility', label: '' })
}
const remove = (index: number) => draft.value.contacts.splice(index, 1)
function move(index: number, by: -1 | 1) {
  const list = draft.value.contacts
  const target = index + by
  if (target < 0 || target >= list.length) return
  const [entry] = list.splice(index, 1)
  list.splice(target, 0, entry!)
}

const save = () => dirty.value && run(() => $fetch<FacilityContactDto>('/api/facility-contact', { method: 'PUT', body: draft.value }), de.common.saved)

// Read-only view.
const address = computed(() => addressLine(data.value?.street ?? '', data.value?.postalCode ?? '', data.value?.city ?? ''))
const entryText = (entry: FacilityContactEntry) => [s.kinds[entry.kind], s.owners[entry.belongsTo], entry.label].filter(part => part !== '').join(' · ')
const href = (entry: FacilityContactEntry) => entry.kind === 'phone' ? telHref(entry.value) : `mailto:${entry.value}`
</script>

<template>
  <section v-if="data" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <form v-if="canEdit" class="space-y-3" novalidate @submit.prevent="save">
      <div class="flex flex-wrap items-end gap-3">
        <UFormField :label="s.street"><UInput v-model="draft.street" maxlength="120" class="w-64" /></UFormField>
        <UFormField :label="s.postalCode"><UInput v-model="draft.postalCode" inputmode="numeric" maxlength="5" class="w-24" /></UFormField>
        <UFormField :label="s.city"><UInput v-model="draft.city" maxlength="120" class="w-48" /></UFormField>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <UFormField :label="s.website"><UInput v-model="draft.website" maxlength="120" :placeholder="s.placeholderWebsite" class="w-64" /></UFormField>
        <UFormField :label="s.operator"><UInput v-model="draft.operator" maxlength="120" class="w-64" /></UFormField>
        <UFormField :label="s.manager"><UInput v-model="draft.manager" maxlength="120" class="w-64" /></UFormField>
      </div>
      <div class="space-y-2">
        <h3 class="text-sm font-medium">{{ s.contacts }}</h3>
        <p v-if="!draft.contacts.length" class="text-sm text-gray-500">{{ s.none }}</p>
        <div v-for="(entry, index) in draft.contacts" :key="index" class="flex flex-wrap items-end gap-2">
          <UFormField :label="s.kind"><USelect v-model="entry.kind" :items="kindItems" class="w-32" /></UFormField>
          <UFormField :label="s.value"><UInput v-model="entry.value" maxlength="120" class="w-56" /></UFormField>
          <UFormField :label="s.belongsTo"><USelect v-model="entry.belongsTo" :items="ownerItems" class="w-36" /></UFormField>
          <UFormField :label="s.label"><UInput v-model="entry.label" maxlength="120" :placeholder="s.labelPlaceholder" class="w-40" /></UFormField>
          <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" :aria-label="s.moveUp" :disabled="index === 0" @click="move(index, -1)" />
          <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" :aria-label="s.moveDown" :disabled="index === draft.contacts.length - 1" @click="move(index, 1)" />
          <UButton icon="i-lucide-trash-2" color="error" variant="ghost" :aria-label="s.remove" @click="remove(index)" />
        </div>
        <UButton icon="i-lucide-plus" color="neutral" variant="outline" :label="s.add" :disabled="draft.contacts.length >= MAX_CONTACT_ENTRIES" @click="add" />
      </div>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <template v-else>
      <dl class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div><dt class="text-xs text-gray-500">{{ s.address }}</dt><dd>{{ address || s.notSet }}</dd></div>
        <div>
          <dt class="text-xs text-gray-500">{{ s.website }}</dt>
          <dd>
            <a v-if="data.website" :href="websiteHref(data.website)" target="_blank" rel="noopener noreferrer" class="text-sky-700 underline">{{ data.website }}</a>
            <template v-else>{{ s.notSet }}</template>
          </dd>
        </div>
        <div><dt class="text-xs text-gray-500">{{ s.operator }}</dt><dd>{{ data.operator || s.notSet }}</dd></div>
        <div><dt class="text-xs text-gray-500">{{ s.manager }}</dt><dd>{{ data.manager || s.notSet }}</dd></div>
      </dl>
      <div class="space-y-1">
        <h3 class="text-sm font-medium">{{ s.contacts }}</h3>
        <p v-if="!data.contacts.length" class="text-sm text-gray-500">{{ s.none }}</p>
        <ul v-else class="space-y-1 text-sm">
          <li v-for="(entry, index) in data.contacts" :key="index">
            {{ entryText(entry) }}: <a :href="href(entry)" class="text-sky-700 underline">{{ entry.value }}</a>
          </li>
        </ul>
      </div>
      <p class="text-xs text-gray-500">{{ s.readOnly }}</p>
    </template>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>
  </section>
</template>
