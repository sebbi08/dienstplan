<script setup lang="ts">
import type { ArchivedChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * Managers only: the archived children with their deletion date; take the leaving back, and for the Träger delete the
 * record right away (the server refuses the Leitung, spec Löschübersicht §1).
 */
const { can } = useCan()
const canDeleteNow = computed(() => can('children.deleteArchived'))
const { data, error, refresh } = useFetch<ArchivedChildDto[]>('/api/children/archive', { key: 'children-archive' })
// A child that left the archive is back in (or gone from) the other lists.
const reloadAll = async () => {
  await Promise.all([refresh(), refreshNuxtData(['children-active', 'children-planned', 'children-birthdays', 'child-documents-overview', 'children-school-children', 'children-occupancy'])])
}
const { busy, run } = useBusyAction(reloadAll)
const confirm = useConfirm()

async function deleteNow(child: ArchivedChildDto) {
  if (await confirm(de.childLifecycle.confirmDelete, { confirmLabel: de.childLifecycle.deleteNow })) {
    run(() => $fetch<unknown>(`/api/children/${child.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}

const th = 'px-3 py-2'
const td = 'px-3 py-2'
</script>

<template>
  <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
  <div v-else-if="data" class="space-y-3">
    <p class="text-sm text-gray-500">{{ de.childLifecycle.archiveHint }}</p>
    <p v-if="!data.length" class="text-sm text-gray-500">{{ de.childLifecycle.archiveEmpty }}</p>
    <div v-else class="overflow-x-auto rounded-lg ring-1 ring-gray-200">
      <table class="w-full bg-white text-sm">
        <thead class="bg-gray-100 text-left text-xs text-gray-600">
          <tr>
            <th :class="th">{{ de.children.fields.name }}</th>
            <th :class="th">{{ de.childLifecycle.leftOn }}</th>
            <th :class="th" />
            <th :class="th" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="child in data" :key="child.id" class="border-t border-gray-100">
            <td :class="td"><NuxtLink :to="`/children/${child.id}`" class="font-medium text-sky-700 hover:underline">{{ child.name }}</NuxtLink></td>
            <td :class="td">{{ formatDate(child.leftOn) }}</td>
            <td :class="[td, 'text-gray-600']">{{ de.childLifecycle.purgeOn(formatDate(child.purgeOn)) }}</td>
            <td :class="[td, 'whitespace-nowrap text-right']">
              <ChildrenUnleaveButton :child-id="child.id" :aria-label="`${de.childLifecycle.unleave}: ${child.name}`" :disabled="busy" :refresh="reloadAll" />
              <UButton v-if="canDeleteNow" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.childLifecycle.deleteNow" :aria-label="`${de.childLifecycle.deleteNow}: ${child.name}`" :disabled="busy" @click="deleteNow(child)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
