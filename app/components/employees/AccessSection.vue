<script setup lang="ts">
import type { Role, UserDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'
import { personRightsMode } from '~/utils/rights'
import { suggestUsername } from '~/utils/staffList'
import { accountLock, manageableRoles } from '#shared/domain/roles'

/**
 * The tab „Zugang“ of an employee: the account linked to the person (role, active, password reset) or, without one,
 * „Zugang einrichten“. The same routes and rights as the users page (users.manage; only a Träger may touch Träger).
 */
const props = defineProps<{ employeeId: number; employeeName: string }>()
const { data: users, refresh } = await useFetch<UserDto[]>('/api/users')
const run = useAction(refresh)
const { can } = useCan()
const canProviderAccounts = computed(() => can('users.providerAccounts'))

/** The account linked to this person, as an editable copy. */
const account = ref<UserDto | null>(null)
watch([users, () => props.employeeId], () => {
  const linked = (users.value ?? []).find(candidate => candidate.employeeId === props.employeeId)
  account.value = linked ? { ...linked } : null
}, { immediate: true })
const { user: sessionUser } = useUserSession()
/** The stored role: the rights belong to the saved account (a changed role is saved first). */
const storedRole = computed(() => (users.value ?? []).find(user => user.id === account.value?.id)?.role)
// As the server: the own account only the Träger changes, a Träger account only a Träger, and a Mitarbeiter with
// „Zugänge verwalten“ only tablet accounts (`accountLock`).
const lock = computed(() => (account.value
  ? accountLock({ id: sessionUser.value?.id, role: sessionUser.value?.role }, can, { id: account.value.id, role: storedRole.value ?? account.value.role })
  : null))
const locked = computed(() => lock.value !== null)
const lockText = computed(() => (lock.value === 'own' ? de.users.ownLocked : lock.value === 'role' ? de.users.roleLocked : de.users.providerLocked))
/** A linked account can be Mitarbeiter or Leitung (a Träger account stays Träger for a Träger); never the tablet. */
const roleItems = computed(() => ((canProviderAccounts.value && account.value?.role === 'provider' ? ['provider'] : []) as Role[])
  .concat(['admin', 'observer']).map(role => ({ label: de.users.roles[role], value: role })))

function save() {
  const target = account.value
  if (!target) return
  run(() => $fetch<unknown>(`/api/users/${target.id}`, {
    method: 'PUT', body: { role: target.role, employeeId: props.employeeId, active: target.active },
  }), de.common.saved)
}

/** The person's rights: the Träger every switch, the Leitung „eintragen und Akten ändern“ of a Mitarbeiter. */
const rightsMode = computed(() => (storedRole.value ? personRightsMode({ role: sessionUser.value?.role, can }, storedRole.value) : null))

const resetOpen = ref(false)
const resetValue = ref('')
function openReset() {
  resetValue.value = ''
  resetOpen.value = true
}
async function submitReset() {
  const target = account.value
  if (!target) return
  const ok = await run(() => $fetch<unknown>(`/api/users/${target.id}/reset-password`, { method: 'POST', body: { password: resetValue.value } }), de.common.saved)
  if (ok) resetOpen.value = false
}

// „Zugang einrichten“: the username proposed from the name until it is changed by hand. Only the roles the actor manages
// (none for a Mitarbeiter with „Zugänge verwalten“: tablets have no person).
const createRoleItems = computed(() => (['observer', 'admin'] as Role[])
  .filter(role => manageableRoles(sessionUser.value?.role, can).includes(role))
  .map(role => ({ label: de.users.roles[role], value: role })))
const form = reactive<{ username: string; password: string; role: Role }>({ username: '', password: '', role: 'observer' })
const usernameEdited = ref(false)
watch([users, () => props.employeeName], () => {
  if (!usernameEdited.value) form.username = suggestUsername(props.employeeName, (users.value ?? []).map(user => user.username))
}, { immediate: true })
async function create() {
  const ok = await run(() => $fetch<unknown>('/api/users', {
    method: 'POST', body: { username: form.username, password: form.password, role: form.role, employeeId: props.employeeId },
  }), de.common.saved)
  if (ok) {
    Object.assign(form, { password: '', role: 'observer' })
    usernameEdited.value = false
  }
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.employees.access.title }}</h2>

    <template v-if="account">
      <p class="text-sm text-gray-600">{{ de.employees.access.linked }}</p>
      <form class="grid gap-3 sm:grid-cols-3 sm:items-end" @submit.prevent="save">
        <UFormField :label="de.users.username">
          <p class="py-1.5 text-sm font-medium">{{ account.username }}</p>
        </UFormField>
        <UFormField :label="de.users.role">
          <p v-if="locked" class="py-1.5 text-sm">{{ de.users.roles[account.role] }}</p>
          <USelect v-else v-model="account.role" :items="roleItems" class="w-full" />
        </UFormField>
        <div class="space-y-1.5 text-sm">
          <label class="flex items-center gap-2">
            <input v-model="account.active" type="checkbox" :disabled="locked"> {{ de.users.active }}
          </label>
        </div>
        <div class="space-y-1 text-xs text-gray-500 sm:col-span-3">
          <p v-if="!account.active">{{ de.employees.access.inactiveHint }}</p>
          <p v-if="account.mustChangePassword">{{ de.users.mustChange }}</p>
          <p v-if="account.lockedUntil && account.lockedUntil > new Date().toISOString()">{{ de.users.locked(formatDateTime(account.lockedUntil)) }}</p>
        </div>
        <p v-if="locked" class="text-xs text-gray-500 sm:col-span-3">{{ lockText }}</p>
        <div v-else class="flex flex-wrap gap-2 sm:col-span-3">
          <UButton type="submit" :label="de.common.save" />
          <UButton color="neutral" variant="outline" icon="i-lucide-key-round" :label="de.users.resetPassword" @click="openReset" />
        </div>
      </form>
      <!-- The person's rights (exceptions from the role). -->
      <template v-if="rightsMode">
        <UsersRightsExceptions v-if="account.role === storedRole" :key="account.id" :user-id="account.id" :mode="rightsMode" />
        <p v-else class="text-xs text-gray-500">{{ de.rights.roleChangedHint }}</p>
      </template>
    </template>

    <template v-else>
      <p class="text-sm text-gray-600">{{ de.employees.access.none }}</p>
      <p v-if="createRoleItems.length === 0" class="text-xs text-gray-500">{{ de.users.roleLocked }}</p>
      <form v-else class="grid gap-3 sm:grid-cols-3 sm:items-start" @submit.prevent="create">
        <UFormField :label="de.users.username" :help="de.employees.access.usernameHint">
          <UInput
            v-model="form.username" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="50"
            class="w-full" required @update:model-value="usernameEdited = true"
          />
        </UFormField>
        <UFormField :label="de.users.password">
          <UInput v-model="form.password" type="password" autocomplete="new-password" minlength="8" maxlength="200" class="w-full" required />
        </UFormField>
        <UFormField :label="de.users.role">
          <USelect v-model="form.role" :items="createRoleItems" class="w-full" />
        </UFormField>
        <p class="text-xs text-gray-500 sm:col-span-3">{{ de.employees.access.passwordHint }}</p>
        <div class="sm:col-span-3"><UButton type="submit" icon="i-lucide-user-plus" :label="de.employees.access.setUp" /></div>
      </form>
    </template>

    <NuxtLink to="/admin/users" class="inline-block text-sm text-sky-700 hover:underline">{{ de.employees.access.usersPage }}</NuxtLink>

    <UModal v-model:open="resetOpen" :title="`${de.users.resetPassword}: ${account?.username ?? ''}`">
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
  </section>
</template>
