<script setup lang="ts">
import { mayEditChildren } from '#shared/domain/roles'
import { de } from '~/locales/de'

const { user } = useUserSession()
// Only those who maintain the records may create one; everybody else goes back to the list.
if (!user.value || !mayEditChildren(user.value)) await navigateTo('/children')

const lookups = useChildLookups()
await lookups.ready
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-left" :label="de.children.back" to="/children" />
    <ChildrenChildMasterForm :lookups="lookups" />
  </div>
</template>
