<script setup lang="ts">
import { bundleDef } from '#shared/domain/permissionBundles'
import type { RightsExceptionsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { bundleTitle } from '~/utils/rights'

// One person's exceptions from the role on the staff list: given ones green, taken away ones struck through; each
// leads to the tab „Zugang“, where they are set.
const props = defineProps<{ employeeId: number; overrides: RightsExceptionsDto['overrides'] }>()
const chips = computed(() => props.overrides.map(({ bundle, effect, scope }) => ({
  bundle,
  grant: effect === 'grant',
  text: effect === 'grant'
    ? `+ ${bundleTitle(bundle)}${bundleDef(bundle).scoped && scope ? ` (${de.rights.scopes[scope]})` : ''}`
    : bundleTitle(bundle),
})))
</script>

<template>
  <span class="flex flex-wrap gap-1">
    <NuxtLink
      v-for="chip in chips" :key="chip.bundle" :to="`/admin/employees/${employeeId}?tab=access`"
      class="rounded px-1.5 py-0.5 text-xs hover:underline"
      :class="chip.grant ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-500 line-through'"
      :title="chip.grant ? de.employees.specialRightGranted : de.employees.specialRightRevoked"
    ><span v-if="!chip.grant" class="sr-only">{{ de.employees.specialRightRevokedShort }}: </span>{{ chip.text }}</NuxtLink>
  </span>
</template>
