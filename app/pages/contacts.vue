<script setup lang="ts">
import { contactVisibility, telHref } from '#shared/domain/contacts'
import { nowInBerlin } from '#shared/domain/timeRecords'
import type { ContactDto, ContactsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import {
  contactAddress, contactPrintPath, contactsOfTab, contactTabFromQuery, contactTabs, websiteLabel, type ContactTab, type ContactTabKey,
} from '~/utils/contacts'
import { targetHints } from '~/utils/documentTargets'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import type { RowAction } from '~/utils/rowActions'

/**
 * „Kontakte“: the facility's address book of external contacts (schools, Jugendamt, Fachberatung …). Whoever maintains
 * it (contacts.manage: Leitung and Träger by default) sees every contact, adds and changes them and the categories;
 * Mitarbeiter accounts and the tablet see the contacts for all (the stricter of the category's „Wer sieht sie?“ and the
 * contact's „Wer sieht ihn?“), read only. On phones a contact shows „Bearbeiten“ and „Löschen“ in a „⋯“ menu. A search (organisation, person,
 * function, note, city) and the categories as sub-tabs (kept in the address) narrow the list; „Drucken“ prints all or
 * the open category (not at the tablet).
 */
const t = de.contacts
const route = useRoute()
const router = useRouter()
const { user } = useUserSession()
const onTablet = computed(() => user.value?.role === 'terminal')

const { data, error, refresh: refreshContacts } = await useFetch<ContactsDto>('/api/contacts', { key: 'contacts' })
// The menu entry of the Mitarbeiter follows the contacts marked for the staff.
const refresh = () => Promise.all([refreshContacts(), refreshNuxtData('contacts-staff-count')])
// At the tablet: contacts limited to groups follow the person who unlocked it.
useRefreshOnTabletUnlock(refreshContacts)
/** The hints for Leitung and Träger: „nur Kita A, Kita B“, „nur Bären, Füchse“, „keine Gruppe mehr gewählt“. */
const hintsOf = (contact: ContactDto) => targetHints(contact.targets, { only: de.documentTargets.only, noGroup: de.documentTargets.noGroup, noFacility: de.documentTargets.noFacility })
const contacts = computed(() => data.value?.contacts ?? [])
const categories = computed(() => data.value?.categories ?? [])
const canManage = computed(() => !!data.value?.canManage)
const tabs = computed(() => contactTabs(categories.value, contacts.value, canManage.value))

const tab = computed<ContactTabKey>({
  get: () => contactTabFromQuery(route.query.kategorie, tabs.value),
  set: value => router.replace({ query: { ...route.query, kategorie: value === 'all' ? undefined : value } }),
})
const search = ref('')
const shown = computed(() => contactsOfTab(contacts.value, tab.value, search.value))
const tabLabel = (entry: ContactTab) => (entry.key === 'all' ? t.all : entry.key === 'provider' ? t.fromProvider : entry.category!.name)
const categoryName = (contact: ContactDto) =>
  (contact.categoryId === null ? t.fromProvider : categories.value.find(category => category.id === contact.categoryId)?.name ?? '')
const printLabel = computed(() => {
  const current = tabs.value.find(entry => entry.key === tab.value)
  return !current || current.key === 'all' ? t.printAll : t.printCategory(tabLabel(current))
})

/** Arrow keys, Home and End move between the sub-tabs (and open the one reached), as in a tab list. */
function onTabKey(event: KeyboardEvent) {
  const keys = tabs.value.map(entry => entry.key)
  const index = keys.indexOf(tab.value)
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  tab.value = keys[next]
  nextTick(() => document.getElementById(`contacts-tab-${keys[next]}`)?.focus())
}

// ---- maintaining -----------------------------------------------------------
const dialogOpen = ref(false)
const editing = ref<ContactDto | null>(null)
const managing = ref(false)
const presetCategoryId = computed(() => (tab.value === 'all' || tab.value === 'provider' ? null : Number(tab.value)))
function openDialog(contact: ContactDto | null) {
  editing.value = contact
  dialogOpen.value = true
}
const { busy, run } = useBusyAction(refresh)
const confirm = useConfirm()
async function remove(contact: ContactDto) {
  if (await confirm(t.confirmDelete(contact.organisation), { danger: true })) {
    run(() => $fetch<{ ok: boolean }>(`/api/contacts/${contact.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
/** „Bearbeiten“ first (on phones the only button, „Löschen“ in „⋯“). */
const actionsOf = (contact: ContactDto): RowAction[] => [
  { key: 'edit', label: de.common.edit, icon: 'i-lucide-pencil', variant: 'ghost', disabled: busy.value, onClick: () => openDialog(contact) },
  { key: 'delete', label: de.common.delete, icon: 'i-lucide-trash-2', color: 'error', variant: 'ghost', disabled: busy.value, onClick: () => remove(contact) },
]
/** The open sub-tab's category (none for „Alle“ and „Vom Träger“). */
const currentCategory = computed(() => tabs.value.find(entry => entry.key === tab.value)?.category ?? null)
/** The note at a contact not everyone sees: its own setting and its category's, the stricter wins ('' for all). */
const badgeOf = (contact: ContactDto) => {
  const category = categories.value.find(entry => entry.id === contact.categoryId)
  return t.visibilityBadge[contactVisibility(category?.visibility ?? null, contact.visibility)]
}
</script>

<template>
  <div class="max-w-5xl min-w-0 space-y-4">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 class="text-2xl font-semibold">{{ t.title }}</h1>
      <div class="ml-auto flex flex-wrap gap-2">
        <UButton
          v-if="!onTablet && contacts.length" color="neutral" variant="outline" icon="i-lucide-printer" :label="printLabel"
          :to="contactPrintPath(tab)" target="_blank"
        />
        <template v-if="canManage">
          <UButton color="neutral" variant="outline" icon="i-lucide-folder-cog" :label="t.manageCategories" @click="managing = true" />
          <UButton icon="i-lucide-plus" :label="t.add" @click="openDialog(null)" />
        </template>
      </div>
    </div>
    <p class="text-sm text-gray-600">{{ canManage ? t.intro : t.introStaff }}</p>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <template v-else>
      <UInput v-model="search" icon="i-lucide-search" :placeholder="t.searchPlaceholder" :aria-label="t.search" class="w-full max-w-md" maxlength="100" />

      <div role="tablist" :aria-label="t.tabsLabel" class="flex flex-wrap gap-1.5">
        <button
          v-for="entry in tabs" :id="`contacts-tab-${entry.key}`" :key="entry.key" type="button" role="tab"
          :aria-selected="tab === entry.key" :tabindex="tab === entry.key ? 0 : -1" aria-controls="contacts-tab-panel"
          class="min-h-11 rounded-full px-4 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="tab === entry.key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
          @click="tab = entry.key" @keydown="onTabKey"
        >
          {{ tabLabel(entry) }} <span class="text-xs text-gray-500">({{ entry.count }})</span>
        </button>
      </div>

      <section id="contacts-tab-panel" role="tabpanel" :aria-labelledby="`contacts-tab-${tab}`" class="space-y-2">
        <p v-if="tab === 'provider'" class="text-sm text-gray-600">{{ t.fromProviderHint }}</p>
        <!-- A category not everyone sees, as at „Zum Ausdrucken“ and „Wissen“. -->
        <span v-else-if="currentCategory && currentCategory.visibility !== 'all'" class="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
          {{ t.visibilityBadge[currentCategory.visibility] }}
        </span>
        <p v-if="!contacts.length" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ canManage ? t.none : t.noneStaff }}</p>
        <p v-else-if="!shown.length" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">
          {{ search.trim() ? t.noMatch : t.emptyCategory }}
        </p>
        <ul v-else class="grid gap-3 md:grid-cols-2">
          <li v-for="contact in shown" :key="contact.id" class="flex flex-col gap-2 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">
            <div class="flex flex-wrap items-start gap-2">
              <div class="min-w-0 flex-1">
                <p class="font-semibold break-words">{{ contact.organisation }}</p>
                <p v-if="contact.person || contact.role" class="text-gray-700">
                  {{ [contact.person, contact.role].filter(Boolean).join(' · ') }}
                </p>
              </div>
              <div class="flex flex-wrap gap-1">
                <span v-if="tab === 'all'" class="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{{ categoryName(contact) }}</span>
                <span v-if="contact.global" class="whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" :title="t.globalHint">{{ contact.allFacilities ? t.global : t.ownerBadge }}</span>
                <!-- „Gilt für“, for Leitung and Träger: „nur Kita A“, „nur Bären, Füchse“. -->
                <span v-for="hint in hintsOf(contact)" :key="hint" class="whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">{{ hint }}</span>
                <!-- Who sees it, when not everyone: the stricter of its category and its own setting. -->
                <span v-if="canManage && badgeOf(contact)" class="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" :title="t.visibilityHint">{{ badgeOf(contact) }}</span>
              </div>
            </div>
            <ul class="space-y-1">
              <li v-if="contact.phone" class="flex items-center gap-2">
                <UIcon name="i-lucide-phone" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
                <a v-if="telHref(contact.phone)" :href="telHref(contact.phone)" class="text-sky-700 hover:underline" :aria-label="t.call(contact.phone)">{{ contact.phone }}</a>
                <span v-else>{{ contact.phone }}</span>
              </li>
              <li v-if="contact.mobile" class="flex items-center gap-2">
                <UIcon name="i-lucide-smartphone" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
                <a v-if="telHref(contact.mobile)" :href="telHref(contact.mobile)" class="text-sky-700 hover:underline" :aria-label="t.call(contact.mobile)">{{ contact.mobile }}</a>
                <span v-else>{{ contact.mobile }}</span>
              </li>
              <li v-if="contact.email" class="flex items-center gap-2">
                <UIcon name="i-lucide-mail" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
                <a :href="`mailto:${contact.email}`" class="break-all text-sky-700 hover:underline" :aria-label="t.mail(contact.email)">{{ contact.email }}</a>
              </li>
              <li v-if="contact.website" class="flex items-center gap-2">
                <UIcon name="i-lucide-globe" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
                <a :href="contact.website" target="_blank" rel="noopener noreferrer" class="break-all text-sky-700 hover:underline" :title="t.openWebsite">{{ websiteLabel(contact.website) }}</a>
              </li>
              <li v-if="contactAddress(contact)" class="flex items-center gap-2">
                <UIcon name="i-lucide-map-pin" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
                <span>{{ contactAddress(contact) }}</span>
              </li>
            </ul>
            <p v-if="contact.note" class="whitespace-pre-line rounded bg-gray-50 p-2 text-gray-700">{{ contact.note }}</p>
            <div v-if="canManage" class="mt-auto flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2">
              <span class="min-w-0 flex-1 text-xs text-gray-500">{{ t.updated(formatDate(nowInBerlin(new Date(contact.updatedAt)).date), contact.updatedBy) }}</span>
              <RowActions v-if="contact.canEdit" :actions="actionsOf(contact)" :name="contact.organisation" size="xs" />
            </div>
          </li>
        </ul>
      </section>
    </template>

    <template v-if="canManage">
      <ContactsContactDialog
        v-model:open="dialogOpen" :contact="editing" :categories="categories" :can-manage-global="!!data?.canManageGlobal"
        :preset-category-id="presetCategoryId" :refresh="refresh"
      />
      <ContactsCategoryManager v-model:open="managing" :categories="categories" :refresh="refresh" />
    </template>
  </div>
</template>
