<script setup lang="ts">
import type { IfsgSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** § 34 IfSG (Leitung and Träger): whether the readmission after a medical judgement needs a written attest. */
const { data, refresh } = await useFetch<IfsgSettingsDto>('/api/ifsg/settings', { key: 'ifsg-settings' })
const { busy, run } = useBusyAction(refresh)
const s = de.ifsg.settings

const requireAttest = ref(false)
watch(data, (value) => {
  if (value) requireAttest.value = value.requireAttest
}, { immediate: true })

const dirty = useDirty(() => !!data.value && requireAttest.value !== data.value.requireAttest)
const save = () => dirty.value && run(() => $fetch<IfsgSettingsDto>('/api/ifsg/settings', {
  method: 'PUT', body: { requireAttest: requireAttest.value },
}), de.common.saved)
</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <form class="space-y-3" @submit.prevent="save">
      <USwitch v-model="requireAttest" :label="s.requireAttest" />
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>
    <p class="text-xs text-gray-500">{{ de.ifsg.footer }}</p>
  </section>
</template>
