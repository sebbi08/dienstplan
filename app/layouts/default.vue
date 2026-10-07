<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { isManager } from '#shared/domain/roles'
import { de } from '~/locales/de'

const { user, loggedIn, clear } = useUserSession()
const today = parseIsoDate(todayIso())
// Sticky on every screen; on phones it slides away while scrolling down and returns when scrolling up.
const headerHidden = useHideOnScroll()

// Unread messages about changed duties show as a count on "Mein Dienstplan"; checked again on every page change.
const notifications = useMyNotifications()
const route = useRoute()
watch(() => route.fullPath, () => {
  if (notifications.enabled.value) notifications.refresh()
})

const links = computed(() => {
  if (!user.value) return []
  const plan = { label: de.nav.plan, to: `/plan/${today.year}/${today.month}` }
  if (user.value.role === 'terminal') return [{ label: de.nav.stamp, to: '/terminal' }, plan]
  const unread = notifications.unread.value.length
  const myPlan = { label: unread ? `${de.nav.myPlan} (${unread})` : de.nav.myPlan, to: `/my/plan/${today.year}/${today.month}` }
  if (isManager(user.value.role)) {
    return [
      plan,
      // An admin linked to an employee stamps on "Mein Dienstplan" too.
      ...(user.value.employeeId !== null ? [myPlan] : []),
      { label: de.nav.time, to: '/admin/time' },
      // Includes the overtime balances and leave accounts of all employees.
      { label: de.nav.employees, to: '/admin/employees' },
      { label: de.nav.closures, to: '/admin/closures' },
      { label: de.nav.sickDays, to: '/admin/sick-days' },
      { label: de.nav.calendar, to: '/admin/calendar' },
      { label: de.nav.users, to: '/admin/users' },
      { label: de.nav.settings, to: '/admin/settings' },
    ]
  }
  return [myPlan, plan, { label: de.nav.myLeave, to: '/my/leave' }]
})

async function logout() {
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header
      v-if="loggedIn" class="sticky top-0 z-40 border-b border-gray-200 bg-white transition-transform duration-200 print:hidden"
      :class="headerHidden ? 'max-md:-translate-y-full' : ''"
    >
      <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-2">
        <NuxtLink to="/" class="font-semibold">{{ de.appName }}</NuxtLink>
        <nav class="flex flex-wrap gap-1">
          <NuxtLink
            v-for="link in links" :key="link.to" :to="link.to"
            class="rounded px-2 py-1 text-sm hover:bg-gray-100" active-class="bg-gray-100 font-medium"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>
        <div class="ml-auto flex items-center gap-2 text-sm">
          <span class="text-gray-500">{{ user?.username }}</span>
          <UButton v-if="user?.role !== 'terminal'" size="xs" color="neutral" variant="ghost" to="/account/password" :label="de.nav.password" />
          <UButton size="xs" color="neutral" variant="outline" :label="de.nav.logout" @click="logout" />
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-[1800px] p-4">
      <slot />
    </main>
  </div>
</template>
