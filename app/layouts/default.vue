<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { isManager } from '#shared/domain/roles'
import type { LeaveSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { isChildPagePath } from '~/utils/children'
import { errorMessage } from '~/utils/errors'

const { user, loggedIn, clear } = useUserSession()
const today = parseIsoDate(todayIso())
// Sticky on every screen; on phones it slides away while scrolling down and returns when scrolling up.
const headerHidden = useHideOnScroll()

// Unread messages about changed duties show as a count on "Mein Dienstplan"; checked again on every page change.
const notifications = useMyNotifications()
// Leave requests: planners see "Urlaubsplanung" with the number of open requests (module switched on by the Träger).
const signedIn = computed(() => !!user.value && user.value.role !== 'terminal')
const { data: leave, refresh: refreshLeave } = useFetch<LeaveSettingsDto>('/api/leave-settings', {
  key: 'leave-settings', immediate: signedIn.value, watch: false,
})
// Facility switcher: the Träger picks the facility they work in, the Leitung only sees theirs.
const { data: facilities, refresh: refreshFacilities, activeName } = useFacilities()
const isProvider = computed(() => user.value?.role === 'provider')
const facilityItems = computed(() => (facilities.value?.facilities ?? []).map(facility => ({ label: facility.name, value: facility.id })))
const toast = useToast()
async function switchFacility(facilityId: number) {
  if (facilityId === facilities.value?.activeId) return
  try {
    await $fetch<unknown>('/api/facilities/active', { method: 'PUT', body: { facilityId } })
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
    return
  }
  // Every page shows data of the active facility, so start over with fresh data. The current page may belong to the old
  // facility (e.g. an employee detail page would 404), so go to the plan start page.
  await reloadNuxtApp({ path: `/plan/${today.year}/${today.month}`, ttl: 0 })
}

const route = useRoute()
watch(() => route.fullPath, () => {
  if (notifications.enabled.value) notifications.refresh()
  if (signedIn.value) refreshLeave()
  if (isManager(user.value?.role)) refreshFacilities()
})

const links = computed(() => {
  if (!user.value) return []
  const plan = { label: de.nav.plan, to: `/plan/${today.year}/${today.month}` }
  if (user.value.role === 'terminal') return [{ label: de.nav.stamp, to: '/terminal' }, plan]
  const unread = notifications.unread.value.length
  const myPlan = { label: unread ? `${de.nav.myPlan} (${unread})` : de.nav.myPlan, to: `/my/plan/${today.year}/${today.month}` }
  const myLeave = { label: de.nav.myLeave, to: '/my/leave' }
  const myRequirements = { label: de.nav.myRequirements, to: '/my/requirements' }
  const open = leave.value?.openCount ?? 0
  const planning = leave.value?.isPlanner
    ? [{ label: open ? `${de.nav.leavePlanning} (${open})` : de.nav.leavePlanning, to: '/admin/leave-planning' }]
    : []
  if (isManager(user.value.role)) {
    return [
      plan,
      // An admin linked to an employee stamps on "Mein Dienstplan", requests leave and sees their own appointments too.
      ...(user.value.employeeId !== null ? [myPlan, myLeave, myRequirements] : []),
      ...planning,
      { label: de.nav.time, to: '/admin/time' },
      // Includes the overtime balances and leave accounts of all employees.
      { label: de.nav.employees, to: '/admin/employees' },
      { label: de.nav.closures, to: '/admin/closures' },
      { label: de.nav.sickDays, to: '/admin/sick-days' },
      // Mitarbeiter see the children only at the tablet, so only the managers get the menu entry.
      { label: de.nav.children, to: '/children' },
      { label: de.nav.calendar, to: '/admin/calendar' },
      { label: de.nav.users, to: '/admin/users' },
      { label: de.nav.settings, to: '/admin/settings' },
    ]
  }
  return [myPlan, plan, myLeave, myRequirements, { label: de.nav.calendar, to: '/my/calendar' }]
})

// At the tablet, a child page shows who unlocked it and the lock button instead of the menu; that bar never slides away,
// so "Sperren" stays in reach on a narrow tablet.
const tabletChildren = computed(() => user.value?.role === 'terminal' && isChildPagePath(route.path))

const pageFacility = usePageFacility()
async function logout() {
  await clear()
  // The next login in this tab must not send the previous account's facility.
  pageFacility.value = null
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header
      v-if="loggedIn" class="sticky top-0 z-40 border-b border-gray-200 bg-white transition-transform duration-200 print:hidden"
      :class="headerHidden && !tabletChildren ? 'max-md:-translate-y-full' : ''"
    >
      <TerminalTabletUnlockBar v-if="tabletChildren" />
      <div v-else class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-2">
        <NuxtLink to="/" class="font-semibold">{{ de.appName }}</NuxtLink>
        <USelect
          v-if="isProvider && facilityItems.length" :model-value="facilities?.activeId ?? undefined" :items="facilityItems"
          size="sm" class="w-48" :aria-label="de.facilities.active" @update:model-value="switchFacility(Number($event))"
        />
        <span v-else-if="activeName" class="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-700" :title="de.facilities.active">{{ activeName }}</span>
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
