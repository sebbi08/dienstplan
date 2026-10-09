<script setup lang="ts">
import { ageOn } from '#shared/domain/children'
import { todayIso } from '#shared/domain/dates'
import type { ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const route = useRoute()
const id = Number(route.params.id)
const { data: child, error, refresh } = await useFetch<ChildRecordDto>(`/api/children/${id}`)
/** The sections wait for this before they accept the next action. */
const reload = () => refresh()
const lookups = useChildLookups()
await lookups.ready

const age = computed(() => (child.value ? ageOn(child.value.master.birthDate, todayIso()) : null))
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-left" :label="de.children.back" to="/children" />
    <p v-if="error || !child" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <template v-else>
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 class="text-2xl font-semibold">{{ child.master.firstName }} {{ child.master.lastName }}</h1>
        <span v-if="age" class="text-gray-600">{{ de.children.age(age.years, age.months) }}</span>
        <span v-if="child.status === 'planned'" class="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">{{ de.children.planned }}</span>
        <span v-else-if="child.status === 'archived'" class="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">{{ de.children.tabs.archive }}</span>
      </div>

      <p v-if="child.status === 'archived'" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{{ de.childLifecycle.archived }}</p>
      <ChildrenChildImportantBox :child="child" />
      <ChildrenChildMasterForm :child="child" :lookups="lookups" :reload="reload" />
      <ChildrenChildContactsSection :child="child" :reload="reload" />
      <ChildrenChildHealthForm :child="child" :reload="reload" />
      <ChildrenChildConsentsForm :child="child" :reload="reload" />
      <ChildrenChildDocumentsSection :child="child" :reload="reload" />
      <ChildrenChildLifecycleSection :child="child" :reload="reload" />
    </template>
  </div>
</template>
