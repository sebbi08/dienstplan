<script setup lang="ts">
import { confirmsName } from '#shared/domain/confirmName'
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { CashBoxDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { cashMonthPath } from '~/utils/cash'

/**
 * All cash boxes of the active facility, grouped by Einrichtung and the groups; archived ones collapsed in „Archiv“ at
 * the end (spec Kasse §4), each with „löschbar ab …“ and, from that day, „Endgültig löschen“ (spec Löschfristen §4).
 */
useHead({ title: de.cash.title })

const { data: boxes, refresh } = await useFetch<CashBoxDto[]>('/api/cash/boxes', { default: () => [] })

interface Section { key: string; title: string; boxes: CashBoxDto[] }
const sections = computed<Section[]>(() => {
  const result: Section[] = []
  // The server sorts: the facility's boxes first, then the groups in their order.
  for (const box of boxes.value.filter(box => !box.archived)) {
    const key = box.groupId === null ? 'facility' : `group-${box.groupId}`
    let section = result.find(item => item.key === key)
    if (!section) result.push(section = { key, title: box.groupName ?? de.cash.facility, boxes: [] })
    section.boxes.push(box)
  }
  return result
})
const archived = computed(() => boxes.value.filter(box => box.archived))

/** The running month, or the start month of a box that starts later. */
function monthLink(box: CashBoxDto): string {
  const today = parseIsoDate(todayIso())
  const later = box.startYear * 12 + box.startMonth > today.year * 12 + today.month
  return later ? cashMonthPath(box.id, box.startYear, box.startMonth) : cashMonthPath(box.id, today.year, today.month)
}

// Arrows to change the order within the facility or a group, only while switched on (like the employee list).
const reordering = ref(false)
const canReorder = computed(() => sections.value.some(section => section.boxes.length > 1))
const run = useAction(refresh)
function move(box: CashBoxDto, direction: 'up' | 'down') {
  return run(() => $fetch(`/api/cash/boxes/${box.id}/move`, { method: 'POST', body: { direction } }))
}

/** From its deletableFrom on (null: neither entries nor history, at once) an archived box may be deleted for good. */
const purgeable = (box: CashBoxDto) => box.archived && (box.deletableFrom === null || todayIso() >= box.deletableFrom)
const purging = ref<CashBoxDto | null>(null)
const purgeName = ref('')
const purgeConfirmed = computed(() => purging.value !== null && confirmsName(purgeName.value, purging.value.name))
/** While the request runs the button waits (a second click would only bring „nicht gefunden“). */
const purgePending = ref(false)
function askPurge(box: CashBoxDto) {
  purging.value = box
  purgeName.value = ''
}
async function confirmPurge() {
  const box = purging.value
  if (!box || !purgeConfirmed.value || purgePending.value) return
  purgePending.value = true
  try {
    const ok = await run(() => $fetch<unknown>(`/api/cash/boxes/${box.id}/purge`, { method: 'DELETE', body: { confirm: purgeName.value } }),
      de.cash.purgeDone(box.name))
    if (ok) purging.value = null
  }
  finally {
    purgePending.value = false
  }
}

const dialogOpen = ref(false)
const editing = ref<CashBoxDto | null>(null)
function openDialog(box: CashBoxDto | null) {
  editing.value = box
  dialogOpen.value = true
}
</script>

<template>
  <div class="max-w-4xl space-y-6">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.cash.title }}</h1>
      <UButton
        v-if="canReorder" class="ml-auto"
        color="neutral" :variant="reordering ? 'solid' : 'outline'" :icon="reordering ? 'i-lucide-check' : 'i-lucide-arrow-up-down'"
        :label="reordering ? de.cash.reorderDone : de.cash.reorder" :aria-pressed="reordering" @click="reordering = !reordering"
      />
      <UButton :class="canReorder ? '' : 'ml-auto'" icon="i-lucide-plus" :label="de.cash.create" @click="openDialog(null)" />
    </div>
    <p v-if="!boxes.length" class="text-sm text-gray-500">{{ de.cash.none }}</p>

    <section v-for="section in sections" :key="section.key" class="space-y-2">
      <h2 class="font-semibold text-gray-700">{{ section.title }}</h2>
      <ul class="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white ring-1 ring-gray-200">
        <CashBoxRow
          v-for="(box, index) in section.boxes" :key="box.id" :box="box" :to="monthLink(box)"
          :reordering="reordering" :first="index === 0" :last="index === section.boxes.length - 1"
          @edit="openDialog(box)" @move="move(box, $event)"
        />
      </ul>
    </section>

    <details v-if="archived.length" class="rounded-lg bg-white ring-1 ring-gray-200">
      <summary class="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700">{{ de.cash.archivedSection(archived.length) }}</summary>
      <ul class="divide-y divide-gray-100 border-t border-gray-100">
        <CashBoxRow
          v-for="box in archived" :key="box.id" :box="box" :to="monthLink(box)" :purgeable="purgeable(box)"
          @edit="openDialog(box)" @purge="askPurge(box)"
        />
      </ul>
    </details>

    <UModal
      :open="purging !== null" :title="purging ? de.cash.purgeTitle(purging.name) : ''"
      @update:open="open => { if (!open && !purgePending) purging = null }"
    >
      <template #body>
        <form v-if="purging" class="space-y-3 text-sm" @submit.prevent="confirmPurge">
          <p class="font-medium">{{ de.cash.purgeIntro }}</p>
          <ul class="list-disc space-y-0.5 pl-5 text-gray-700">
            <li v-for="item in de.cash.purgeItems" :key="item">{{ item }}</li>
          </ul>
          <p class="text-gray-600">{{ de.cash.purgeTransfers }}</p>
          <p class="font-medium text-amber-800">{{ de.cash.purgeBackupHint }}</p>
          <UFormField :label="de.cash.purgeTypeName(purging.name)">
            <UInput v-model="purgeName" class="w-full" autocomplete="off" />
          </UFormField>
          <div class="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="purging = null" />
            <UButton
              type="submit" color="error" icon="i-lucide-trash-2" :label="de.cash.purge"
              :loading="purgePending" :disabled="!purgeConfirmed || purgePending"
            />
          </div>
        </form>
      </template>
    </UModal>

    <CashBoxDialog v-model:open="dialogOpen" :box="editing" @saved="refresh" />
  </div>
</template>
