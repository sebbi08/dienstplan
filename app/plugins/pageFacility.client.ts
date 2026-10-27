import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { PAGE_FACILITY_HEADER, SETTINGS_FACILITY_HEADER } from '#shared/domain/pageFacility'
import { de } from '~/locales/de'
import { errorCode } from '~/utils/errors'
import { isSettingsPath, settingsFacilityHeader } from '~/utils/settingsFacility'

/**
 * Every API request of this page names the facility the page was loaded for (once known), so a Träger who switched
 * facility in another window cannot read or change the new facility from this old page: the server answers 409
 * `facility_changed`, and the page starts over in the active facility.
 *
 * On the settings pages the Träger may choose another facility's settings („Einstellungen für“): the requests made
 * there name it as well, and the server works with it instead of the active one for that request only. Leaving the
 * settings drops the choice and fetches the data on screen afresh, so no other page shows that facility's data.
 *
 * It wraps the browser's fetch rather than $fetch, because useFetch keeps the $fetch instance it got when the app
 * loaded; $fetch and useFetch both end up in window.fetch.
 */
export default defineNuxtPlugin(() => {
  const pageFacility = usePageFacility()
  const settingsFacility = useSettingsFacility()
  const router = useRouter()
  const toast = useToast()
  const browserFetch = window.fetch.bind(window)
  let reloading = false

  function isApi(input: RequestInfo | URL): boolean {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    return url.origin === window.location.origin && url.pathname.startsWith('/api/')
  }

  function startOver() {
    if (reloading) return
    reloading = true
    toast.add({ id: 'facility-changed', title: de.errors.facility_changed, color: 'warning' })
    // The current page may belong to the other facility (e.g. an employee), so start on the plan like the switcher.
    const today = parseIsoDate(todayIso())
    setTimeout(() => reloadNuxtApp({ path: `/plan/${today.year}/${today.month}`, ttl: 0 }), 1500)
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (pageFacility.value === null || !isApi(input)) return browserFetch(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set(PAGE_FACILITY_HEADER, String(pageFacility.value))
    const settings = settingsFacilityHeader(router.currentRoute.value.path, settingsFacility.value, pageFacility.value)
    if (settings !== null) headers.set(SETTINGS_FACILITY_HEADER, settings)
    const response = await browserFetch(input, { ...init, headers })
    if (response.status === 409) {
      const body: unknown = await response.clone().json().catch(() => null)
      if (errorCode({ data: body }) === 'facility_changed') startOver()
    }
    return response
  }

  router.afterEach((to) => {
    if (settingsFacility.value === null || isSettingsPath(to.path)) return
    settingsFacility.value = null
    // Data shared with other pages (groups, settings …) may still hold the other facility's answer.
    void refreshNuxtData()
  })
})
