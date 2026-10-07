<script setup lang="ts">
import { isManager } from '#shared/domain/roles'
import type { LeaveSettingsDto, UserDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Träger only: switch leave requests on and choose who is responsible for leave planning. */
const { data: settings, refresh } = await useFetch<LeaveSettingsDto>('/api/leave-settings', { key: 'leave-settings' })
const { data: users } = await useFetch<UserDto[]>('/api/users')
const run = useAction(refresh)

const form = reactive({ enabled: false, plannerIds: [] as number[] })
watch(settings, (value) => {
  if (value) Object.assign(form, { enabled: value.enabled, plannerIds: [...value.plannerIds] })
}, { immediate: true })

const candidates = computed(() => (users.value ?? []).filter(user => user.active && isManager(user.role)))

function toggle(id: number, on: boolean) {
  form.plannerIds = on ? [...form.plannerIds, id] : form.plannerIds.filter(other => other !== id)
}

function save() {
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
    <p class="text-xs text-gray-500">{{ de.leavePlanning.moduleHint }}</p>
    <UButton type="submit" :label="de.common.save" />
  </form>
</template>
