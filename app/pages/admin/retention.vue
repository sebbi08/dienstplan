<script setup lang="ts">
import type { RetentionDeleteResult, RetentionItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { areaPath, privacyPath, requestedPrivacyTab, sectionAnchor, visiblePrivacyTabs, type PrivacyTab } from '~/utils/settingsAreas'

/**
 * „Datenschutz & Löschen“ (Mehr, the Träger; the Leitung reads her own facility's staff periods, reached from
 * Einstellungen → Mitarbeitende) – one page with up to three tabs, each with its own right:
 * - „Jetzt löschbar“ (retention.delete, spec Löschübersicht §2): every item of every facility that may be deleted after
 *   its retention period, with a button per row and „Alle fälligen löschen“ (exactly the rows shown, so the facility
 *   filter counts), „Später löschbar“ by date without buttons. The server sorts and checks due-ness again before
 *   deleting. A cash box asks for its name, like the cash page did before.
 * - „Fristen“ (settings.facility): the Löschfrist of children (one for all facilities, the Träger) and the Löschfristen
 *   of staff, applicants and cash boxes of ONE facility – the one chosen in „Einstellungen für“ (this page counts as a
 *   settings page for it, so a choice made in the settings is kept and sent along), named above them; links to the other
 *   privacy-relevant settings.
 * - „Datensicherung“ (backup.download, one for all).
 * `?tab=periods` / `?tab=backup` open a tab; the old settings anchors lead here (MOVED_SECTIONS). Unsaved edits ask
 * before the page or a tab is left, as on the settings pages.
 */
const t = de.retentionPage
const p = de.privacy
useHead({ title: p.title })
const route = useRoute()
const router = useRouter()
const { can } = useCan()
const canDeleteDue = computed(() => can('retention.delete'))
const tabs = computed(() => visiblePrivacyTabs(can))
if (!tabs.value.length) await navigateTo('/', { replace: true })
const tab = computed<PrivacyTab>(() => requestedPrivacyTab(route.query.tab, tabs.value))
useUnsavedGuard()
/** The tabs are separate forms: unsaved edits ask first (switching unmounts them). */
async function selectTab(next: PrivacyTab) {
  if (next === tab.value) return
  if (hasUnsavedChanges() && !await confirm(de.settingsAreas.unsavedConfirm, { confirmLabel: de.settingsAreas.unsavedLeave, danger: true })) return
  await router.replace({ query: next === tabs.value[0] ? {} : { tab: next } })
}
/** Arrow keys, Home and End move between the tabs (and open the one reached), as in a tab list. */
async function onTabKey(event: KeyboardEvent) {
  const keys = tabs.value
  const index = keys.indexOf(tab.value)
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  const target = keys[next]
  await selectTab(target)
  if (tab.value === target) nextTick(() => document.getElementById(`privacy-tab-${target}`)?.focus())
}

// The staff periods are per facility: „Einstellungen für“ as in the settings (the Träger with more than one facility).
const { data: facilities } = useFacilities()
const chosenFacility = useSettingsFacility()
const shownFacility = useSettingsFacilityId()
const facilityItems = computed(() => (facilities.value?.facilities ?? []).map(facility => ({ label: facility.name, value: facility.id })))
const showFacilityChoice = computed(() => can('settings.otherFacility') && facilityItems.value.length > 1)
const shownFacilityName = computed(() => facilities.value?.facilities.find(facility => facility.id === shownFacility.value)?.name ?? '')
async function chooseFacility(facilityId: number) {
  if (!Number.isInteger(facilityId) || facilityId === shownFacility.value) return
  if (hasUnsavedChanges() && !await confirm(de.settingsAreas.unsavedConfirm, { confirmLabel: de.settingsAreas.unsavedSwitch, danger: true })) return
  chosenFacility.value = facilityId === facilities.value?.activeId ? null : facilityId
  await refreshNuxtData()
}

const { data, error, refresh } = await useFetch<RetentionItemDto[]>('/api/retention', {
  key: 'retention-overview', default: () => [], immediate: canDeleteDue.value,
})

const ALL = 'all'
const facilityFilter = ref(ALL)
const filterItems = computed(() => {
  const names = new Map<number, string>()
  for (const item of data.value) names.set(item.facilityId, item.facilityName)
  return [
    { label: t.allFacilities, value: ALL },
    ...[...names].sort((a, b) => a[1].localeCompare(b[1], 'de')).map(([id, name]) => ({ label: name, value: String(id) })),
  ]
})
// A facility that no longer has items (all deleted) falls back to „Alle Einrichtungen“.
watch(filterItems, (items) => {
  if (!items.some(item => item.value === facilityFilter.value)) facilityFilter.value = ALL
})
const shown = computed(() => data.value.filter(item => facilityFilter.value === ALL || String(item.facilityId) === facilityFilter.value))
const due = computed(() => shown.value.filter(item => item.due))
const later = computed(() => shown.value.filter(item => !item.due))

/** „‹Name› – ‹Datenart›“; BEM and Mutterschutz records also say when the BEM ended and whether the person is still employed. */
const whatOf = (item: RetentionItemDto) => {
  if (item.applicantState === 'open') return t.itemLabel(item.name, `${t.kinds.applicant} (${t.openApplicant(item.quietMonths ?? 12)})`)
  const what = t.itemLabel(item.name, item.kind === 'employee' ? t.categories[item.category ?? 'record'] : t.categories[item.kind])
  if (item.bem) return `${what} (${t.bemDetail(formatDate(item.bem.endedOn), item.bem.employed)})`
  if (item.accidentHold) return `${what} (${t.accidentHold})`
  return item.maternity ? `${what} (${t.maternityDetail(formatDate(item.maternity.endedOn), item.maternity.employed)})` : what
}

/** The date, or without one: at once (cash box without entries, a record whose other data is gone) or after the rest. */
const fromOf = (item: RetentionItemDto) =>
  item.deletableFrom ? t.fromDate(formatDate(item.deletableFrom)) : item.due ? t.fromNow : t.fromAfterRest

const toast = useToast()
const confirm = useConfirm()
const { busy, guard } = useBusy()
/** The row whose „Löschen“ runs (its button shows the spinner). */
const pendingKey = ref<string | null>(null)
const bulkPending = ref(false)
/** The cash box whose name is asked for. */
const purging = ref<RetentionItemDto | null>(null)

function removeItem(item: RetentionItemDto): Promise<boolean> {
  return guard(async () => {
    pendingKey.value = item.key
    try {
      await $fetch('/api/retention/items', { method: 'DELETE', body: { key: item.key } })
      toast.add({ title: t.deletedOne(whatOf(item)), color: 'success' })
      return true
    }
    catch (failure) {
      toast.add({ title: errorMessage(failure), color: 'error' })
      return false
    }
    finally {
      pendingKey.value = null
      // Also after an error: the row may be gone or changed meanwhile.
      await refresh()
    }
  })
}

async function deleteOne(item: RetentionItemDto) {
  if (busy.value) return
  if (item.kind === 'cash') {
    purging.value = item
    return
  }
  if (await confirm(t.confirmOne(whatOf(item)))) await removeItem(item)
}

async function confirmPurge() {
  const item = purging.value
  if (item && await removeItem(item)) purging.value = null
}

/** The route takes at most 1000 keys at once. */
const CHUNK = 1000

async function deleteAll() {
  const items = due.value
  if (!items.length || busy.value) return
  const counts = (['employee', 'child', 'cash', 'signRequest', 'infoVisit', 'applicant'] as const)
    .map(kind => ({ kind, count: items.filter(item => item.kind === kind).length }))
    .filter(entry => entry.count > 0)
    .map(entry => t.countOf(entry.count, t.kinds[entry.kind]))
    .join(', ')
  if (!await confirm(t.confirmAll(counts))) return
  const keys = items.map(item => item.key)
  await guard(async () => {
    bulkPending.value = true
    let deleted = 0
    let skipped = 0
    try {
      for (let start = 0; start < keys.length; start += CHUNK) {
        const result = await $fetch<RetentionDeleteResult>('/api/retention/due', { method: 'POST', body: { keys: keys.slice(start, start + CHUNK) } })
        deleted += result.deleted
        skipped += result.skipped.length
      }
      toast.add({
        title: t.deletedAll(deleted), description: skipped ? t.skipped(skipped) : undefined, color: skipped ? 'warning' : 'success',
      })
      return true
    }
    catch (failure) {
      // Earlier chunks may have gone through: say so, the error alone would hide it.
      toast.add({ title: errorMessage(failure), description: deleted ? t.deletedAll(deleted) : undefined, color: 'error' })
      return false
    }
    finally {
      bulkPending.value = false
      await refresh()
    }
  })
}
</script>

<template>
  <div v-if="tabs.length" class="max-w-4xl space-y-6">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">{{ p.title }}</h1>
      <div v-if="tabs.length > 1" role="tablist" :aria-label="p.tabsLabel" class="flex flex-wrap gap-1.5">
        <button
          v-for="key in tabs" :id="`privacy-tab-${key}`" :key="key" type="button" role="tab"
          :aria-selected="tab === key" :tabindex="tab === key ? 0 : -1" :aria-controls="`privacy-panel-${key}`"
          class="min-h-10 rounded-full px-3.5 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="tab === key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
          @click="selectTab(key)" @keydown="onTabKey"
        >
          {{ p.tabs[key] }}
        </button>
      </div>
    </div>

    <div v-if="tab === 'periods'" id="privacy-panel-periods" role="tabpanel" aria-labelledby="privacy-tab-periods" class="space-y-4">
      <p class="text-sm text-gray-600">{{ p.periodsIntro }}</p>
      <!-- One for all facilities (the Träger). -->
      <div v-if="can('settings.retention')" class="space-y-1">
        <SettingsGlobalBadge />
        <SettingsChildRetentionSection />
      </div>
      <!-- Per facility: the one chosen in „Einstellungen für“ (kept from the settings), named here. -->
      <div class="space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">{{ p.forFacility }}:</span>
          <USelect
            v-if="showFacilityChoice" :model-value="shownFacility ?? undefined" :items="facilityItems" :aria-label="p.forFacility"
            class="w-full sm:w-64" @update:model-value="chooseFacility(Number($event))"
          />
          <span v-else class="text-sm font-semibold">{{ shownFacilityName }}</span>
        </div>
        <p class="text-xs text-gray-600">{{ p.perFacilityHint(shownFacilityName) }}</p>
        <SettingsEmployeeRetentionSection :key="shownFacility ?? 'active'" />
      </div>
      <section class="space-y-2 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">
        <h2 class="font-semibold">{{ p.related }}</h2>
        <ul class="list-inside list-disc space-y-1 text-sky-700">
          <li><NuxtLink :to="`${areaPath('children')}#${sectionAnchor('consent-questions')}`" class="hover:underline">{{ p.relatedConsents }}</NuxtLink></li>
          <li><NuxtLink :to="`${areaPath('children')}#${sectionAnchor('document-types')}`" class="hover:underline">{{ p.relatedDocumentTypes }}</NuxtLink></li>
          <li><NuxtLink :to="`${areaPath('facility')}#${sectionAnchor('tablet')}`" class="hover:underline">{{ p.relatedTablet }}</NuxtLink></li>
          <li v-if="can('rights.manage')"><NuxtLink to="/admin/users/rights" class="hover:underline">{{ p.relatedRights }}</NuxtLink></li>
        </ul>
      </section>
    </div>

    <div v-else-if="tab === 'backup'" id="privacy-panel-backup" role="tabpanel" aria-labelledby="privacy-tab-backup" class="space-y-1">
      <SettingsGlobalBadge />
      <SettingsBackupSection />
    </div>

    <div v-else-if="canDeleteDue" id="privacy-panel-due" role="tabpanel" aria-labelledby="privacy-tab-due" class="space-y-6">
    <p class="text-sm text-gray-600">
      {{ t.intro }}
      <NuxtLink :to="privacyPath('backup')" class="font-medium text-sky-700 hover:underline">{{ t.backupLink }}</NuxtLink>
    </p>

    <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <p v-else-if="!data.length" class="text-sm text-gray-500">{{ t.empty }}</p>
    <template v-else>
      <UFormField :label="t.facility" class="max-w-xs">
        <USelect v-model="facilityFilter" :items="filterItems" class="w-full" />
      </UFormField>

      <section class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="font-semibold text-gray-700">{{ t.dueTitle(due.length) }}</h2>
          <UButton
            v-if="due.length" class="ml-auto" color="error" icon="i-lucide-trash-2" :label="t.deleteAll"
            :loading="bulkPending" :disabled="busy" @click="deleteAll"
          />
        </div>
        <p v-if="!due.length" class="text-sm text-gray-500">{{ t.noneDue }}</p>
        <ul v-else class="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
          <li v-for="item in due" :key="item.key" class="flex items-center gap-3 px-3 py-2">
            <RetentionItemText :facility="item.facilityName" :what="whatOf(item)" :from="fromOf(item)" />
            <UButton
              size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.delete"
              :loading="pendingKey === item.key" :disabled="busy" @click="deleteOne(item)"
            />
          </li>
        </ul>
      </section>

      <section v-if="later.length" class="space-y-2">
        <h2 class="font-semibold text-gray-700">{{ t.laterTitle }}</h2>
        <ul class="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
          <li v-for="item in later" :key="item.key" class="flex items-center gap-3 px-3 py-2">
            <RetentionItemText :facility="item.facilityName" :what="whatOf(item)" :from="fromOf(item)" />
          </li>
        </ul>
      </section>
    </template>

    </div>

    <CashPurgeDialog :name="purging?.name ?? null" :pending="busy" @close="purging = null" @confirm="confirmPurge" />
  </div>
</template>
