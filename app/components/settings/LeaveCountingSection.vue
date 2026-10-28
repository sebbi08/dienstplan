<script setup lang="ts">
import type { LeaveCountingDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Dienstplan, below „Urlaubsanträge“ (per facility, „Einstellungen für“ applies): whether a leave day on
 * 24 or 31 December counts as a whole or half a day. The Träger changes it, the Leitung sees it read-only (the server
 * checks as well).
 */
const t = de.leaveCounting
const { data, refresh } = await useFetch<LeaveCountingDto>('/api/leave-counting', { key: 'leave-counting' })
const { can } = useCan()
const canConfigure = computed(() => can('leave.configure'))
const { busy, run } = useBusyAction(refresh)

const form = reactive({ value: 'whole' as 'whole' | 'half' })
watch(data, (value) => { if (value) form.value = value.christmasEveHalfLeave ? 'half' : 'whole' }, { immediate: true })
const items = [{ label: t.whole, value: 'whole' }, { label: t.half, value: 'half' }]

const dirty = useDirty(() => canConfigure.value && !!data.value && (form.value === 'half') !== data.value.christmasEveHalfLeave)
const save = () => dirty.value && run(() => $fetch<LeaveCountingDto>('/api/leave-counting', {
  method: 'PUT', body: { christmasEveHalfLeave: form.value === 'half' },
}), de.common.saved)
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <p v-if="!canConfigure" class="text-xs text-gray-500">{{ t.providerOnly }}</p>
    <form class="space-y-3" @submit.prevent="save">
      <UFormField :label="t.label">
        <URadioGroup v-model="form.value" orientation="horizontal" :items="items" :disabled="!canConfigure" />
      </UFormField>
      <UButton v-if="canConfigure" type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
