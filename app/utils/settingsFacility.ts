/**
 * The Träger may edit the settings of another facility than the active one without switching it: the settings pages
 * then name that facility in a request header (see plugins/pageFacility.client.ts), the rest of the app stays on the
 * active facility. Pure helpers, so a test can load this file.
 */

/** The settings pages: /admin/settings and everything below it (areas, a group's page). */
export function isSettingsPath(path: string): boolean {
  return path === '/admin/settings' || path.startsWith('/admin/settings/')
}

/**
 * The value of the settings facility header for a request made on `path`: the chosen facility while on a settings page
 * and it is not the active one, otherwise null (nothing is sent).
 */
export function settingsFacilityHeader(path: string, chosen: number | null, active: number | null): string | null {
  if (chosen === null || chosen === active || !isSettingsPath(path)) return null
  return String(chosen)
}
