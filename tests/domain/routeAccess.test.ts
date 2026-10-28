import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountRedirect, isChildPagePath, pagePermission, tabletMayOpen } from '../../app/utils/routeAccess'
import { effectivePermissions, ROLE_DEFAULTS } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

/**
 * Rechte und Rollen Teil 1 (RF5): where the route middleware sends every role, written down from the role-based
 * middleware before it switched to the permissions. Every page of app/pages is listed, so a new page needs a decision.
 */

const PAGES_DIR = join(process.cwd(), 'app', 'pages')
const PARAMS: Record<string, string> = { year: '2026', month: '10', area: 'roster', date: '2026-10-28' }
/** The address of every page file, with sample values for its parameters. */
const pagePaths = (readdirSync(PAGES_DIR, { recursive: true }) as string[])
  .filter(file => file.endsWith('.vue'))
  .map((file) => {
    const parts = relative(PAGES_DIR, join(PAGES_DIR, file)).split(sep).join('/').replace(/\.vue$/, '').split('/')
    const path = parts.filter(part => part !== 'index').map(part => part.replace(/^\[(\w+)\]$/, (_, name: string) => PARAMS[name] ?? '1'))
    return `/${path.join('/')}`
  })
  .filter((path, index, all) => all.indexOf(path) === index)
  .sort()

/** Pages every signed-in account opens (the login page is handled before the account rules). */
const OPEN = [
  '/', '/account/password', '/login', '/my/calendar', '/my/leave', '/my/plan/2026/10', '/my/requirements', '/my/talks',
  '/my/talks/1', '/plan/2026/10', '/print/2026/10', '/print/my-forms/1', '/print/team-meetings/1', '/team-meetings',
  '/team-meetings/1',
]
/** The child pages and their printouts: Leitung and Träger with their own account, a Mitarbeiter only at the tablet. */
const CHILDREN = [
  '/children', '/children/1', '/children/new', '/print/children/attendance-month/2026/10',
  '/print/children/attendance/2026-10-28', '/print/children/birthdays', '/print/children/documents',
  '/print/children/forms/1', '/print/children/occupancy/2026', '/print/children/overview/1', '/print/children/planned',
  '/print/children/staffing/2026/10', '/print/children/week/1/1',
]
/** The office pages: Leitung and Träger only. */
const OFFICE = [
  '/admin/calendar', '/admin/closures', '/admin/employees', '/admin/employees/1', '/admin/forms',
  '/admin/leave-planning', '/admin/print/calendar/2026', '/admin/print/cash/1/2026/10', '/admin/print/early-closures/2026',
  '/admin/print/emergency-contacts', '/admin/print/form-templates/1', '/admin/print/forms/1',
  '/admin/print/sick-days/2026', '/admin/print/time/1/2026/10', '/admin/settings', '/admin/settings/groups/1',
  '/admin/settings/roster', '/admin/sick-days', '/admin/time', '/admin/users', '/cash', '/cash/1/2026/10', '/templates',
  '/terminal',
]
/** The Träger's page for deleting after the retention periods. */
const RETENTION = '/admin/retention'

function viewerOf(role: Role, options: { canEditChildren?: boolean, mustChangePassword?: boolean } = {}) {
  const permissions = effectivePermissions({
    role, canEditChildren: options.canEditChildren ?? false, isLeavePlanner: false, contractVisibleToAdmins: false,
  })
  return { role, mustChangePassword: options.mustChangePassword ?? false, can: (key: Parameters<typeof permissions.has>[0]) => permissions.has(key) }
}

describe('route access per role (unchanged by the permissions)', () => {
  it('lists every page', () => {
    expect(pagePaths).toEqual([...OPEN, ...CHILDREN, ...OFFICE, RETENTION].sort())
  })

  it('lets the Träger open every page', () => {
    const provider = viewerOf('provider')
    for (const path of pagePaths) expect(accountRedirect(path, provider), path).toBeUndefined()
  })

  it('lets the Leitung open every page but the Träger\'s retention page', () => {
    const leitung = viewerOf('admin')
    for (const path of [...OPEN, ...CHILDREN, ...OFFICE]) expect(accountRedirect(path, leitung), path).toBeUndefined()
    // Before the permissions the retention page sent the Leitung to the start page itself (retention.vue); now the
    // middleware does, with the same result.
    expect(accountRedirect(RETENTION, leitung)).toBe('/')
  })

  it('sends a Mitarbeiter from the child and office pages to the start page, with or without the child flag', () => {
    for (const viewer of [viewerOf('observer'), viewerOf('observer', { canEditChildren: true })]) {
      for (const path of OPEN) expect(accountRedirect(path, viewer), path).toBeUndefined()
      for (const path of [...CHILDREN, ...OFFICE, RETENTION]) expect(accountRedirect(path, viewer), path).toBe('/')
    }
  })

  it('sends everyone who must change the password to that page first', () => {
    for (const role of ['provider', 'admin', 'observer'] as const) {
      const viewer = viewerOf(role, { mustChangePassword: true })
      expect(accountRedirect('/account/password', viewer)).toBeUndefined()
      for (const path of pagePaths.filter(path => path !== '/account/password')) {
        expect(accountRedirect(path, viewer), path).toBe('/account/password')
      }
    }
  })

  it('keeps unknown office addresses for the managers', () => {
    expect(accountRedirect('/admin', viewerOf('admin'))).toBeUndefined()
    expect(accountRedirect('/admin/unknown', viewerOf('admin'))).toBeUndefined()
    expect(accountRedirect('/admin/unknown', viewerOf('observer'))).toBe('/')
    expect(accountRedirect('/cash/9', viewerOf('observer'))).toBe('/')
  })

  it('lets the tablet open stamping, the plan, the print templates and the team meetings, the child pages by unlock', () => {
    const tablet = ['/plan/2026/10', '/team-meetings', '/team-meetings/1', '/templates', '/terminal']
    expect(pagePaths.filter(tabletMayOpen)).toEqual(tablet)
    expect(pagePaths.filter(isChildPagePath)).toEqual(['/children', '/children/1', '/children/new'])
  })
})

describe('pagePermission', () => {
  it('names a key of the Leitung defaults for every child and office page, none for the open pages', () => {
    for (const path of OPEN) expect(pagePermission(path), path).toBeNull()
    for (const path of [...CHILDREN, ...OFFICE]) {
      const key = pagePermission(path)
      expect(ROLE_DEFAULTS.admin, path).toContain(key)
      expect(ROLE_DEFAULTS.observer, path).not.toContain(key)
    }
    expect(pagePermission(RETENTION)).toBe('retention.delete')
  })
})
