export default defineNuxtConfig({
  compatibilityDate: '2026-09-30',
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  ui: { fonts: false, colorMode: false },
  devtools: { enabled: false },
  app: {
    head: { htmlAttrs: { lang: 'de' }, title: 'Dienstplan' },
  },
  // Child data never stays in the browser cache (the shared tablet above all): the JSON answers and the pages that are
  // rendered with it on the server.
  routeRules: Object.fromEntries([
    '/api/children', '/api/children/**', '/api/child-contacts/**', '/api/child-documents/**', '/api/child-group-changes/**', '/api/terminal/**',
    '/children', '/children/**', '/print/children/**',
  ].map(path => [path, { headers: { 'Cache-Control': 'no-store' } }])),
  runtimeConfig: {
    session: {
      // About the browser cookie cap, so the shared tablet stays logged in; normal accounts get 30 days
      // at login and are checked server-side in requireUser (USER_SESSION_DAYS).
      maxAge: 60 * 60 * 24 * 400,
      cookie: { secure: true },
    },
  },
})
