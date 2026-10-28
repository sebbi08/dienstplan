<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { LeaveSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { pathAfterFacilitySwitch } from '~/utils/facilitySwitch'
import { isEntryActive, isGroupActive, navMenu, navLabelWithCount, type NavEntry, type NavMenu } from '~/utils/navMenu'
import { isChildPagePath } from '~/utils/routeAccess'
import type { DropdownMenuItem } from '@nuxt/ui'

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
const { can } = useCan()
// Switching the facility is the Träger's (PUT /api/facilities/active needs facilities.manage).
const canSwitchFacility = computed(() => can('facilities.manage'))
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
  // Every page shows data of the active facility, so start over with fresh data on the same page; a page of one record of
  // the old facility (e.g. an employee, which would 404) goes to the list of its area.
  await reloadNuxtApp({ path: pathAfterFacilitySwitch(route.fullPath), ttl: 0 })
}

const route = useRoute()
watch(() => route.fullPath, () => {
  if (notifications.enabled.value) notifications.refresh()
  if (signedIn.value) refreshLeave()
  if (can('settings.facility')) refreshFacilities()
})

// The entries, grouped: Leitung/Träger see the everyday pages directly and the rest under "Mehr" (and their own pages
// under "Meins" when linked to an employee); Mitarbeiter have a short row and their own lists under "Meins", the tablet
// its short list.
const menu = computed<NavMenu>(() => navMenu({
  role: user.value?.role ?? 'observer',
  can,
  employeeId: user.value?.employeeId ?? null,
  isPlanner: !!leave.value?.isPlanner,
  openCount: leave.value?.openCount ?? 0,
  unread: notifications.unread.value.length,
  today,
}))
const isTerminal = computed(() => user.value?.role === 'terminal')
// The Leitung/Träger header has many entries; on mid-size screens it gets tighter so it stays on one line.
const tight = computed(() => menu.value.more.length > 0)
const toItems = (entries: NavEntry[]): DropdownMenuItem[] =>
  entries.map(entry => ({ label: entry.label, to: entry.to, active: isEntryActive(route.path, entry) }))
// Passwort ändern sits under "Mehr" for Leitung/Träger, set apart from the pages ("Mehr" is active on it, too).
const passwordEntry: NavEntry = { label: de.nav.password, to: '/account/password', match: '/account/password' }
const moreItems = computed<DropdownMenuItem[][]>(() => [
  toItems(menu.value.more),
  toItems([passwordEntry]).map(item => ({ ...item, icon: 'i-lucide-key-round' })),
])
const moreEntries = computed(() => [...menu.value.more, passwordEntry])
const mineItems = computed(() => toItems(menu.value.mine))
const linkClass = (entry: NavEntry) => (isEntryActive(route.path, entry) ? 'bg-gray-100 font-medium' : '')
const groupClass = (entries: NavEntry[]) => (isGroupActive(route.path, entries) ? 'bg-gray-100 font-medium' : '')

// Phones: one header line with a "Menü" button that opens a panel with every entry; it closes after a tap or page change.
const menuOpen = ref(false)
watch(() => route.fullPath, () => { menuOpen.value = false })
const phoneGroups = computed(() => [
  { title: '', entries: menu.value.main },
  { title: navLabelWithCount(de.nav.mine, menu.value.mineCount), entries: menu.value.mine },
  { title: de.nav.more, entries: menu.value.more },
].filter(group => group.entries.length))

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
      <!-- The tablet keeps its header exactly as before; the spacing below only applies to the other accounts. -->
      <div
        v-else class="mx-auto flex max-w-[1800px] items-center px-4 py-2"
        :class="isTerminal ? 'flex-wrap gap-3' : 'gap-x-3 gap-y-2 md:flex-wrap md:max-xl:gap-x-2'"
      >
        <NuxtLink to="/" class="font-semibold" :class="isTerminal ? '' : 'shrink-0'">{{ de.appName }}</NuxtLink>
        <USelect
          v-if="canSwitchFacility && facilityItems.length" :model-value="facilities?.activeId ?? undefined" :items="facilityItems"
          size="sm" class="min-w-0 max-md:max-w-48 max-md:flex-1 md:w-32 xl:w-48" :aria-label="de.facilities.active"
          @update:model-value="switchFacility(Number($event))"
        />
        <span
          v-else-if="activeName" class="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-700"
          :class="isTerminal ? '' : 'min-w-0 truncate'" :title="isTerminal ? de.facilities.active : `${de.facilities.active}: ${activeName}`"
        >{{ activeName }}</span>
        <!-- Wide screens (and always at the tablet): the entries in the header line. -->
        <nav :aria-label="de.nav.mainMenu" class="flex-wrap" :class="isTerminal ? 'flex gap-1' : 'hidden items-center gap-0.5 md:flex'">
          <NuxtLink
            v-for="link in menu.main" :key="link.to" :to="link.to"
            class="rounded py-1 text-sm hover:bg-gray-100"
            :class="[linkClass(link), isTerminal ? 'px-2' : tight ? 'whitespace-nowrap px-1.5 xl:px-2' : 'whitespace-nowrap px-2']"
          >
            {{ link.label }}
          </NuxtLink>
          <UDropdownMenu v-if="menu.more.length" :items="moreItems" :content="{ align: 'start' }">
            <UButton
              color="neutral" variant="ghost" size="sm" :label="de.nav.more" trailing-icon="i-lucide-chevron-down"
              class="px-1.5 py-1 text-sm font-normal text-gray-900 xl:px-2" :class="groupClass(moreEntries)"
            />
          </UDropdownMenu>
          <UDropdownMenu v-if="menu.mine.length" :items="mineItems" :content="{ align: 'start' }">
            <UButton
              color="neutral" variant="ghost" size="sm" :label="navLabelWithCount(de.nav.mine, menu.mineCount)" trailing-icon="i-lucide-chevron-down"
              class="whitespace-nowrap px-1.5 py-1 text-sm font-normal text-gray-900 xl:px-2" :class="groupClass(menu.mine)"
            />
          </UDropdownMenu>
        </nav>
        <div class="ml-auto items-center gap-2 text-sm" :class="isTerminal ? 'flex' : 'hidden md:flex'">
          <span class="text-gray-500" :class="tight ? 'hidden xl:inline' : ''">{{ user?.username }}</span>
          <UButton v-if="!isTerminal && !tight" size="xs" color="neutral" variant="ghost" to="/account/password" :label="de.nav.password" />
          <UButton
            size="xs" color="neutral" variant="outline" :label="de.nav.logout" :title="`${de.nav.signedInAs} ${user?.username ?? ''}`"
            :class="tight ? 'hidden xl:inline-flex' : ''" @click="logout"
          />
          <!-- Leitung/Träger below xl: only the icon, so the header of a laptop stays on one line. -->
          <UButton
            v-if="tight" size="xs" color="neutral" variant="outline" icon="i-lucide-log-out" class="xl:hidden"
            :aria-label="de.nav.logout" :title="`${de.nav.logout} (${de.nav.signedInAs} ${user?.username ?? ''})`" @click="logout"
          />
        </div>
        <!-- Phones: one line, everything else in the panel behind "Menü". -->
        <UButton
          v-if="!isTerminal" color="neutral" variant="outline" size="sm" icon="i-lucide-menu"
          :label="navLabelWithCount(de.nav.menu, menu.totalCount)" class="ml-auto shrink-0 md:hidden" @click="menuOpen = true"
        />
      </div>
    </header>
    <USlideover
      v-if="loggedIn && !isTerminal" v-model:open="menuOpen" :title="de.nav.menu"
      :description="`${de.nav.signedInAs} ${user?.username ?? ''}`" class="print:hidden"
    >
      <template #body>
        <nav :aria-label="de.nav.mainMenu" class="flex flex-col gap-4">
          <div v-for="group in phoneGroups" :key="group.title">
            <p v-if="group.title" class="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{{ group.title }}</p>
            <NuxtLink
              v-for="link in group.entries" :key="link.to" :to="link.to"
              class="block rounded px-2 py-2 hover:bg-gray-100" :class="linkClass(link)" @click="menuOpen = false"
            >
              {{ link.label }}
            </NuxtLink>
          </div>
        </nav>
      </template>
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton color="neutral" variant="ghost" icon="i-lucide-key-round" to="/account/password" :label="de.nav.password" @click="menuOpen = false" />
          <UButton color="neutral" variant="outline" icon="i-lucide-log-out" :label="de.nav.logout" @click="logout" />
        </div>
      </template>
    </USlideover>
    <main class="mx-auto max-w-[1800px] p-4">
      <slot />
    </main>
  </div>
</template>
