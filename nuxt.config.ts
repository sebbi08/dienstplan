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
      maxAge: 60 * 60 * 24 * 30,
      cookie: { secure: true },
    },
  },
})
