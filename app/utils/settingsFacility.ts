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

/**
 * What a finished navigation does to the chosen facility: `keep` it (none chosen, still in the settings, or the
 * navigation failed or was refused, e.g. the Träger stays because of unsaved edits: the draft on screen still belongs to
 * the chosen facility), `drop` it and fetch the data on screen afresh (the settings were really left), or drop it
 * `quietly` (signed out: fetching afresh would only answer 401).
 */
export function afterSettingsNavigation(
  navigation: { toPath: string; failed: boolean; chosen: number | null; signedIn: boolean },
): 'keep' | 'drop' | 'quietly' {
  if (navigation.chosen === null || navigation.failed || isSettingsPath(navigation.toPath)) return 'keep'
  return navigation.signedIn ? 'drop' : 'quietly'
}

/** Whether a link of the settings (e.g. in „Was noch fehlt“) leads out of them, where the active facility applies. */
export function leavesSettings(to: string): boolean {
  return !isSettingsPath(to.split(/[?#]/)[0] ?? '')
}
