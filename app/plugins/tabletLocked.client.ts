import { errorCode } from '~/utils/errors'
import { isChildPagePath } from '~/utils/children'

/**
 * At the tablet, any answer 403 `tablet_locked` (the lock time ran out on the server, or another person unlocked)
 * forgets the unlock and goes back to the start page - from a child page; a late answer after the tablet left them
 * (e.g. for the plan, which locks) leaves it where it is.
 *
 * Like plugins/pageFacility.client.ts it wraps the browser's fetch rather than $fetch, because useFetch keeps the $fetch
 * instance it got when the app loaded; $fetch and useFetch both end up in window.fetch.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const { user } = useUserSession()
  const unlock = useTabletUnlock()
  const router = useRouter()
  const browserFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await browserFetch(input, init)
    if (response.status === 403 && user.value?.role === 'terminal') {
      const body: unknown = await response.clone().json().catch(() => null)
      if (errorCode({ data: body }) === 'tablet_locked') {
        unlock.value = { unlocked: false }
        if (isChildPagePath(router.currentRoute.value.path)) nuxtApp.runWithContext(() => navigateTo('/terminal'))
      }
    }
    return response
  }
})
