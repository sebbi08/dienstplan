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
  nitro: {
    hooks: {
      // Nitro types every $fetch/useFetch by matching the URL against all API routes at the type level. Past ~310 routes
      // that matching exceeds TypeScript's instantiation limit (TS2589) and the failure spreads as implicit `any` across
      // the app. Every call here names its response type explicitly ($fetch<T>, useFetch<T>), which takes precedence
      // over the route inference anyway, so the generated route table is left empty. Type generation only, no runtime effect.
      'types:extend'(types) {
        for (const route of Object.keys(types.routes)) delete types.routes[route]
      },
    },
  },
  runtimeConfig: {
    session: {
      // Set at runtime via NUXT_SESSION_PASSWORD. '' is the module's own default; since Nuxt 4.6 the
      // nuxt-auth-utils 0.5 types for runtimeConfig.session apply here and require the key.
      password: '',
      // About the browser cookie cap, so the shared tablet stays logged in; normal accounts get 30 days
      // at login and are checked server-side in requireUser (USER_SESSION_DAYS).
      maxAge: 60 * 60 * 24 * 400,
      cookie: { secure: true },
    },
  },
})
