/**
 * Request header in which the browser page names the facility it was loaded for (see app/plugins/pageFacility.client.ts
 * and server/lib/pageFacility.ts).
 */
export const PAGE_FACILITY_HEADER = 'X-Facility-Id'

/**
 * Request header in which a Träger's settings page names the facility whose settings it shows when that is not the
 * active one (see app/plugins/pageFacility.client.ts and server/lib/pageFacility.ts). Only sent from the settings pages.
 */
export const SETTINGS_FACILITY_HEADER = 'X-Settings-Facility'
