<script setup lang="ts">
import type { RetentionDeleteResult, RetentionItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { sectionAnchor } from '~/utils/settingsAreas'

/**
 * Mehr → Löschfristen, only for the Träger (spec Löschübersicht §2): every item of every facility that may be deleted
 * after its retention period. „Jetzt löschbar“ with a button per row and „Alle fälligen löschen“ (exactly the rows
 * shown, so the facility filter counts), „Später löschbar“ by date without buttons. The server sorts and checks
 * due-ness again before deleting. A cash box asks for its name, like the cash page did before.
 */
const t = de.retentionPage
useHead({ title: t.title })

const { user } = useUserSession()
const isProvider = computed(() => user.value?.role === 'provider')
if (!isProvider.value) await navigateTo('/', { replace: true })

const { data, error, refresh } = await useFetch<RetentionItemDto[]>('/api/retention', {
  key: 'retention-overview', default: () => [], immediate: isProvider.value,
})

const ALL = 'all'
const facilityFilter = ref(ALL)
const facilityItems = computed(() => {
  const names = new Map<number, string>()
  for (const item of data.value) names.set(item.facilityId, item.facilityName)
  return [
    { label: t.allFacilities, value: ALL },
    ...[...names].sort((a, b) => a[1].localeCompare(b[1], 'de')).map(([id, name]) => ({ label: name, value: String(id) })),
  ]
})
// A facility that no longer has items (all deleted) falls back to „Alle Einrichtungen“.
watch(facilityItems, (items) => {
  if (!items.some(item => item.value === facilityFilter.value)) facilityFilter.value = ALL
})
const shown = computed(() => data.value.filter(item => facilityFilter.value === ALL || String(item.facilityId) === facilityFilter.value))
const due = computed(() => shown.value.filter(item => item.due))
const later = computed(() => shown.value.filter(item => !item.due))

/** „‹Name› – ‹Datenart›“. */
const whatOf = (item: RetentionItemDto) =>
  t.itemLabel(item.name, item.kind === 'employee' ? t.categories[item.category ?? 'record'] : t.categories[item.kind])

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
  const counts = (['employee', 'child', 'cash'] as const)
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
  <div v-if="isProvider" class="max-w-4xl space-y-6">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">{{ t.title }}</h1>
      <p class="text-sm text-gray-600">
        {{ t.intro }}
        <NuxtLink :to="`/admin/settings/facility#${sectionAnchor('backup')}`" class="font-medium text-sky-700 hover:underline">{{ t.backupLink }}</NuxtLink>
      </p>
    </div>

    <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <p v-else-if="!data.length" class="text-sm text-gray-500">{{ t.empty }}</p>
    <template v-else>
      <UFormField :label="t.facility" class="max-w-xs">
        <USelect v-model="facilityFilter" :items="facilityItems" class="w-full" />
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

    <CashPurgeDialog :name="purging?.name ?? null" :pending="busy" @close="purging = null" @confirm="confirmPurge" />
  </div>
</template>
