<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'

const { user, loggedIn, clear } = useUserSession()
const today = parseIsoDate(todayIso())
// Sticky on every screen; on phones it slides away while scrolling down and returns when scrolling up.
const headerHidden = useHideOnScroll()
const route = useRoute()

interface NavLink { label: string; to: string }
/** A plain link, or a group shown as one header item with a drop-down. */
type NavItem = NavLink | { label: string; children: NavLink[] }

const isGroupActive = (item: NavItem) => 'children' in item && item.children.some(child => route.path.startsWith(child.to))

const links = computed((): NavItem[] => {
  if (!user.value) return []
  const plan = { label: de.nav.plan, to: `/plan/${today.year}/${today.month}` }
  if (user.value.role === 'terminal') return [{ label: de.nav.stamp, to: '/terminal' }, plan]
  const myPlan = { label: de.nav.myPlan, to: `/my/plan/${today.year}/${today.month}` }
  if (user.value.role === 'admin') {
    return [
      plan,
      // An admin linked to an employee stamps on "Mein Dienstplan" too.
      ...(user.value.employeeId !== null ? [myPlan] : []),
      { label: de.nav.time, to: '/admin/time' },
      {
        label: de.nav.employees,
        children: [
          { label: de.nav.employees, to: '/admin/employees' },
          { label: de.nav.balances, to: '/admin/balances' },
          { label: de.nav.leave, to: '/admin/leave' },
        ],
      },
      { label: de.nav.closures, to: '/admin/closures' },
      { label: de.nav.earlyClosures, to: '/admin/early-closures' },
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
          <template v-for="item in links" :key="item.label">
            <UDropdownMenu v-if="'children' in item" :items="item.children.map(child => ({ label: child.label, to: child.to }))">
              <button
                type="button" class="inline-flex items-center gap-0.5 rounded px-2 py-1 text-sm hover:bg-gray-100"
                :class="isGroupActive(item) ? 'bg-gray-100 font-medium' : ''"
              >
                {{ item.label }} <UIcon name="i-lucide-chevron-down" class="size-3.5" />
              </button>
            </UDropdownMenu>
            <NuxtLink v-else :to="item.to" class="rounded px-2 py-1 text-sm hover:bg-gray-100" active-class="bg-gray-100 font-medium">
              {{ item.label }}
            </NuxtLink>
          </template>
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
