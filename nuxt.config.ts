export default defineNuxtConfig({
  compatibilityDate: '2026-09-30',
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  ui: { fonts: false, colorMode: false },
  devtools: { enabled: false },
  app: {
    head: { htmlAttrs: { lang: 'de' }, title: 'Dienstplan' },
  },
  runtimeConfig: {
    session: {
      // About the browser cookie cap, so the shared tablet stays logged in; normal accounts get 30 days
      // at login and are checked server-side in requireUser (USER_SESSION_DAYS).
      maxAge: 60 * 60 * 24 * 400,
      cookie: { secure: true },
    },
  },
})
