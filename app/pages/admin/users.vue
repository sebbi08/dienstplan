<script setup lang="ts">
import type { EmployeeListItemDto, Role, UserDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

const { data: users, refresh } = await useFetch<UserDto[]>('/api/users')
const { data: employees } = await useFetch<EmployeeListItemDto[]>('/api/employees')
const run = useAction(refresh)
const { activeName } = useFacilities()

const rows = ref<UserDto[]>([])
watch(users, value => (rows.value = (value ?? []).map(user => ({ ...user }))), { immediate: true })

const { user: me } = useUserSession()
// Only a Träger may appoint Träger or change their accounts; the server checks this as well.
const isProvider = computed(() => me.value?.role === 'provider')
const roleItems = computed(() => ((isProvider.value ? ['provider'] : []) as Role[]).concat(['admin', 'observer', 'terminal'])
  .map(role => ({ label: de.users.roles[role], value: role })))
const locked = (user: UserDto) => user.role === 'provider' && !isProvider.value
const form = reactive<{ username: string; password: string; role: Role; employeeId: number | null }>({
  username: '', password: '', role: 'observer', employeeId: null,
})
watch(() => form.role, (role) => {
  if (role === 'terminal') form.employeeId = null
})

const resetTarget = ref<UserDto | null>(null)
const resetValue = ref('')
const resetOpen = computed({
  get: () => resetTarget.value !== null,
  set: (open) => { if (!open) resetTarget.value = null },
})

async function create() {
  const ok = await run(() => $fetch<unknown>('/api/users', { method: 'POST', body: { ...form } }), de.common.saved)
  if (ok) Object.assign(form, { username: '', password: '', employeeId: null })
}

function save(user: UserDto) {
  run(() => $fetch<unknown>(`/api/users/${user.id}`, {
    method: 'PUT', body: { role: user.role, employeeId: user.role === 'terminal' ? null : user.employeeId, active: user.active, canEditChildren: user.canEditChildren },
  }), de.common.saved)
}

function openReset(user: UserDto) {
  resetValue.value = ''
  resetTarget.value = user
}

async function submitReset() {
  const target = resetTarget.value
  if (!target) return
  const ok = await run(() => $fetch<unknown>(`/api/users/${target.id}/reset-password`, { method: 'POST', body: { password: resetValue.value } }), de.common.saved)
  if (ok) resetTarget.value = null
}

const selectClass = 'h-8 rounded-md border border-gray-300 bg-white px-2 text-sm'
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.users.title }}</h1>
    <p class="text-sm text-gray-500">{{ de.users.rolesHint }}</p>
    <p class="text-sm text-gray-500">„{{ de.users.canEditChildren }}“: {{ de.users.canEditChildrenHint }}</p>
    <p v-if="activeName" class="text-sm text-gray-500">{{ de.facilities.createdIn(activeName) }}</p>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.users.username }}</th><th class="px-3 py-2">{{ de.users.role }}</th>
          <th class="px-3 py-2">{{ de.users.employee }}</th><th class="px-3 py-2">{{ de.users.canEditChildren }}</th><th class="px-3 py-2">{{ de.users.active }}</th>
          <th class="px-3 py-2">{{ de.users.status }}</th><th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in rows" :key="user.id" class="border-t border-gray-100">
          <td class="px-3 py-2 font-medium">{{ user.username }}</td>
          <td class="px-3 py-2">
            <span v-if="locked(user)">{{ de.users.roles.provider }}</span>
            <USelect v-else v-model="user.role" :items="roleItems" class="w-40" />
          </td>
          <td class="px-3 py-2">
            <select v-model="user.employeeId" :class="selectClass" :disabled="user.role === 'terminal' || locked(user)">
              <option :value="null">{{ de.users.noEmployee }}</option>
              <option v-for="employee in employees ?? []" :key="employee.id" :value="employee.id">{{ employee.name }}</option>
            </select>
          </td>
          <td class="px-3 py-2 text-center">
            <!-- Leitung and Träger always maintain child records, the tablet never sees them: only Mitarbeiter accounts need the flag. -->
            <input v-if="user.role === 'observer'" v-model="user.canEditChildren" type="checkbox" :aria-label="de.users.canEditChildren" :disabled="locked(user)">
            <span v-else class="text-gray-300">–</span>
          </td>
          <td class="px-3 py-2 text-center"><input v-model="user.active" type="checkbox" :disabled="locked(user)"></td>
          <td class="px-3 py-2 text-xs text-gray-500">
            <div v-if="user.mustChangePassword">{{ de.users.mustChange }}</div>
            <div v-if="user.lockedUntil && user.lockedUntil > new Date().toISOString()">{{ de.users.locked(formatDateTime(user.lockedUntil)) }}</div>
          </td>
          <td v-if="locked(user)" class="px-3 py-2 text-right text-xs text-gray-500">{{ de.users.providerLocked }}</td>
          <td v-else class="whitespace-nowrap px-3 py-2 text-right">
            <UButton size="xs" :label="de.common.save" @click="save(user)" />
            <UButton size="xs" color="neutral" variant="ghost" :label="de.users.resetPassword" @click="openReset(user)" />
          </td>
        </tr>
      </tbody>
    </table>

    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-4">{{ de.users.create }}</h2>
      <UFormField :label="de.users.username"><UInput v-model="form.username" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" class="w-full" required /></UFormField>
      <UFormField :label="de.users.password"><UInput v-model="form.password" type="password" autocomplete="new-password" class="w-full" required /></UFormField>
      <UFormField :label="de.users.role"><USelect v-model="form.role" :items="roleItems" class="w-full" /></UFormField>
      <UFormField :label="de.users.employee">
        <select v-model="form.employeeId" :class="[selectClass, 'w-full']" :disabled="form.role === 'terminal'">
          <option :value="null">{{ de.users.noEmployee }}</option>
          <option v-for="employee in employees ?? []" :key="employee.id" :value="employee.id">{{ employee.name }}</option>
        </select>
      </UFormField>
      <div class="sm:col-span-4"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>

    <UModal v-model:open="resetOpen" :title="`${de.users.resetPassword}: ${resetTarget?.username ?? ''}`">
      <template #body>
        <form class="space-y-3" @submit.prevent="submitReset">
          <UFormField :label="de.users.newPassword"><UInput v-model="resetValue" type="password" autocomplete="new-password" class="w-full" required /></UFormField>
          <p class="text-xs text-gray-500">{{ de.users.resetHint }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="resetOpen = false" />
            <UButton type="submit" :label="de.common.save" />
          </div>
        </form>
      </template>
    </UModal>

    <UsersRightsTable v-if="isProvider" />
  </div>
</template>
