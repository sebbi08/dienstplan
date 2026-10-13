<script setup lang="ts">
import type { OpenChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

/** The active children with sections still to be confirmed after a group change, one row per child with the open sections. */
const { data, error } = useFetch<OpenChildDto[]>('/api/children/open', { key: 'children-open' })
const { groupName } = useChildLookups()

const showGroups = computed(() => (data.value ?? []).some(child => child.groupId !== null))

const th = 'px-3 py-2'
const td = 'px-3 py-2'
</script>

<template>
  <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
  <div v-else-if="data" class="space-y-3">
    <p class="text-sm text-gray-500">{{ de.groupChange.openHint }}</p>
    <p v-if="!data.length" class="text-sm text-gray-500">{{ de.groupChange.openEmpty }}</p>
    <div v-else class="overflow-x-auto rounded-lg ring-1 ring-gray-200">
      <table class="w-full bg-white text-sm">
        <thead class="bg-gray-100 text-left text-xs text-gray-600">
          <tr>
            <th :class="th">{{ de.children.fields.name }}</th>
            <th v-if="showGroups" :class="th">{{ de.children.fields.group }}</th>
            <th :class="th">{{ de.groupChange.openSections }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="child in data" :key="child.id" class="border-t border-gray-100">
            <td :class="td"><NuxtLink :to="`/children/${child.id}`" class="font-medium text-sky-700 hover:underline">{{ child.name }}</NuxtLink></td>
            <td v-if="showGroups" :class="td">{{ groupName(child.groupId) }}</td>
            <td :class="td">
              <span class="flex flex-wrap gap-1">
                <UBadge v-for="section in child.sections" :key="section" color="warning" variant="subtle" size="sm" :label="de.groupChange.sections[section]" />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
