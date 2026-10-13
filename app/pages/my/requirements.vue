<script setup lang="ts">
import type { MyRequirementsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { intervalText } from '~/utils/requirements'

/**
 * The viewer's own mandatory appointments and trainings, read-only. Plain dates in plain text: the early warning (states,
 * colours) is for Leitung and Träger only.
 */
const { data, error } = await useFetch<MyRequirementsDto>('/api/my/requirements')
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.requirements.myTitle }}</h1>
    <p class="text-sm text-gray-500">{{ de.requirements.myHint }}</p>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <template v-if="data">
      <section class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <h2 class="mb-2 font-semibold">{{ de.requirements.kinds }}</h2>
        <!-- A list, not a table: most employees read this on their phone. -->
        <ul class="divide-y divide-gray-100 text-sm">
          <li v-for="kind in data.kinds" :key="kind.type.id" class="py-2">
            <div class="flex flex-wrap items-baseline justify-between gap-x-3">
              <span class="font-medium">{{ kind.type.name }}</span>
              <span class="text-xs text-gray-500">{{ intervalText(kind.type.intervalMonths) }}</span>
            </div>
            <dl class="mt-1 grid grid-cols-2 gap-x-3">
              <div>
                <dt class="text-xs text-gray-500">{{ de.requirements.lastDate }}</dt>
                <dd>{{ kind.lastDate ? formatDate(kind.lastDate) : de.requirements.none }}</dd>
              </div>
              <div>
                <dt class="text-xs text-gray-500">{{ de.requirements.myDueOn }}</dt>
                <dd>{{ kind.dueOn ? formatDate(kind.dueOn) : de.requirements.none }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </section>
      <section class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <h2 class="mb-2 font-semibold">{{ de.requirements.trainings }}</h2>
        <p v-if="data.trainings.length === 0" class="text-sm text-gray-500">{{ de.requirements.noTrainings }}</p>
        <ul v-else class="divide-y divide-gray-100 text-sm">
          <li v-for="training in data.trainings" :key="training.id" class="flex gap-3 py-1.5">
            <span class="whitespace-nowrap">{{ formatDate(training.date) }}</span>
            <span>{{ training.title }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
