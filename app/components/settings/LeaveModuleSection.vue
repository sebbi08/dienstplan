<script setup lang="ts">
import type { LeaveSettingsDto, UserDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Träger only: switch leave requests on and choose the Träger accounts told about new requests. Who plans and decides
 * is the right „planen und genehmigen“ (rights page).
 */
const { data: settings, refresh } = await useFetch<LeaveSettingsDto>('/api/leave-settings', { key: 'leave-settings' })
const { data: users } = await useFetch<UserDto[]>('/api/users')
const run = useAction(refresh)

const form = reactive({ enabled: false, plannerIds: [] as number[] })
watch(settings, (value) => {
  if (value) Object.assign(form, { enabled: value.enabled, plannerIds: [...value.plannerIds].sort((a, b) => a - b) })
}, { immediate: true })

const candidates = computed(() => (users.value ?? []).filter(user => user.active && user.role === 'provider'))

function toggle(id: number, on: boolean) {
  form.plannerIds = on ? [...form.plannerIds, id] : form.plannerIds.filter(other => other !== id)
}

const dirty = useDirty(() => !!settings.value && (form.enabled !== settings.value.enabled
  || !sameValue([...form.plannerIds].sort((a, b) => a - b), [...settings.value.plannerIds].sort((a, b) => a - b))))

function save() {
  if (!dirty.value) return
  run(() => $fetch<unknown>('/api/leave-settings/module', { method: 'PUT', body: { ...form } }), de.common.saved)
}
</script>

<template>
  <form class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="save">
    <h2 class="font-semibold">{{ de.leavePlanning.module }}</h2>
    <USwitch v-model="form.enabled" :label="de.leavePlanning.moduleEnabled" />
    <div class="space-y-1">
      <p class="text-sm font-medium">{{ de.leavePlanning.planners }}</p>
      <label v-for="user in candidates" :key="user.id" class="flex items-center gap-2 text-sm">
        <input type="checkbox" :checked="form.plannerIds.includes(user.id)" @change="toggle(user.id, ($event.target as HTMLInputElement).checked)">
        {{ user.username }} <span class="text-gray-500">({{ de.users.roles[user.role] }})</span>
      </label>
    </div>
    <p class="text-xs text-gray-500">{{ de.leavePlanning.plannersHint }}</p>
    <p v-if="candidates.length === 0" class="text-sm text-amber-700">{{ de.leavePlanning.noProvider }}</p>
    <p class="text-xs text-gray-500">
      {{ de.leavePlanning.moduleHint }}
      <NuxtLink to="/admin/rights" class="text-sky-700 hover:underline">{{ de.users.rightsPage }}</NuxtLink>
    </p>
    <UButton type="submit" :label="de.common.save" :disabled="!dirty" />
  </form>
</template>
