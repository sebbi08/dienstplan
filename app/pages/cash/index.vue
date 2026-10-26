<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { CashBoxDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { cashMonthPath } from '~/utils/cash'

/** All cash boxes of the active facility, grouped by Einrichtung and the groups; archived ones collapsed at the end (spec Kasse §4). */
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
      <UButton class="ml-auto" icon="i-lucide-plus" :label="de.cash.create" @click="openDialog(null)" />
    </div>
    <p v-if="!boxes.length" class="text-sm text-gray-500">{{ de.cash.none }}</p>

    <section v-for="section in sections" :key="section.key" class="space-y-2">
      <h2 class="font-semibold text-gray-700">{{ section.title }}</h2>
      <ul class="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white ring-1 ring-gray-200">
        <CashBoxRow v-for="box in section.boxes" :key="box.id" :box="box" :to="monthLink(box)" @edit="openDialog(box)" />
      </ul>
    </section>

    <details v-if="archived.length" class="rounded-lg bg-white ring-1 ring-gray-200">
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium text-gray-600">{{ de.cash.archivedSection(archived.length) }}</summary>
      <ul class="divide-y divide-gray-100 border-t border-gray-100">
        <CashBoxRow v-for="box in archived" :key="box.id" :box="box" :to="monthLink(box)" @edit="openDialog(box)" />
      </ul>
    </details>

    <CashBoxDialog v-model:open="dialogOpen" :box="editing" @saved="refresh" />
  </div>
</template>
