/*
 * Offline shell of the facility tablet's stamping page (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“).
 *
 * Registered only by the tablet account on its stamping page (app/composables/useOfflineStamps.ts), with the scope
 * /terminal and ?v=<build id>, never in development. It keeps:
 *   - the page /terminal (network first: online it is always fetched fresh and the copy replaced; only without an
 *     answer, or with a server error, the kept copy is shown). The page carries no team data: the stamping page loads
 *     the list in the browser, and keeps names and ids for stamping in IndexedDB itself.
 *   - the build's files under /_nuxt/ (cache first: their names change with every build), and the icon data
 *     /api/_nuxt_icon/ (network first).
 * Every other request, every other API request above all, passes through untouched: no API answer is kept, so no
 * child data either. Other pages are outside the scope and keep their normal online behaviour.
 * A new deploy has a new build id and so a new worker with a new cache; on activation the caches of older builds are
 * deleted.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'none'
const PREFIX = 'terminal-shell-'
const CACHE = PREFIX + VERSION
const PAGE = '/terminal'

/** Only a real, signed-in page: not a redirect to the login, not an error. */
function isPage(response) {
  return response.ok && !response.redirected && response.type === 'basic'
    && (response.headers.get('content-type') || '').includes('text/html')
}

/** Only the app's own build files and icon data. */
function isKeptFile(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith('/_nuxt/') || url.pathname.startsWith('/api/_nuxt_icon/'))
}

async function keepFiles(cache, urls) {
  const wanted = [...new Set(urls)].map(url => new URL(url, self.location.origin)).filter(isKeptFile)
  await Promise.allSettled(wanted.map(url => cache.add(url.href)))
}

/** Fetches the stamping page and keeps it with the build files it names. */
async function keepPage(cache) {
  const response = await fetch(PAGE, { credentials: 'same-origin', cache: 'no-store' })
  if (!isPage(response)) return
  const html = await response.clone().text()
  await cache.put(PAGE, response)
  await keepFiles(cache, [...html.matchAll(/(?:src|href)="(\/_nuxt\/[^"]+)"/g)].map(match => match[1]))
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      await keepPage(await caches.open(CACHE))
    }
    catch {
      // No network while installing: the page is kept with its next online load.
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

/** The page hands over the build files it loaded before this worker took over. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'keep' && Array.isArray(event.data.urls)) {
    event.waitUntil(caches.open(CACHE).then(cache => keepFiles(cache, event.data.urls)))
  }
})

async function pageNetworkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (isPage(response)) {
      await cache.put(PAGE, response.clone())
      return response
    }
    if (response.status >= 500) return (await cache.match(PAGE)) || response
    return response
  }
  catch (error) {
    const kept = await cache.match(PAGE)
    if (kept) return kept
    throw error
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
    return response
  }
  catch (error) {
    const kept = await cache.match(request)
    if (kept) return kept
    throw error
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const kept = await cache.match(request)
  if (kept) return kept
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    if (url.pathname === PAGE) event.respondWith(pageNetworkFirst(request))
    return
  }
  if (url.pathname.startsWith('/_nuxt/builds/') || url.pathname.startsWith('/api/_nuxt_icon/')) {
    event.respondWith(networkFirst(request))
    return
  }
  if (url.pathname.startsWith('/_nuxt/')) event.respondWith(cacheFirst(request))
  // Everything else goes to the network as without this worker.
})
