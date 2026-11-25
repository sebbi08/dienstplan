import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOVED_PAGES, calendarTabs, isAreaTabActive, movedLocation, staffAreaTabs, userTabs } from '../../app/utils/areaTabs'
import { navMenu } from '../../app/utils/navMenu'
import { accountRedirect, pageKeys } from '../../app/utils/routeAccess'
import { tabletStartTiles } from '../../app/utils/tabletStart'
import { openItemLinks } from '../../app/utils/openItems'
import { effectivePermissions } from '../../shared/domain/permissionBundles'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { MyOpenItemsDto, Role } from '../../shared/types/api'

const canOf = (role: Role) => {
  const permissions = effectivePermissions({ role })
  return (key: PermissionKey) => permissions.has(key)
}
const page = (path: string) => readFileSync(join(process.cwd(), 'app', 'pages', path), 'utf8')
const NOTHING: MyOpenItemsDto = { knowledge: 0, sign: 0, signOverdue: 0, selfAssessments: 0, leaveDecisions: 0, leaveNotice: false, requirements: 0 }

describe('former menu entries as tabs', () => {
  it('shows each role the tabs it may use', () => {
    expect(calendarTabs(canOf('admin')).map(tab => tab.to)).toEqual(['/admin/calendar', '/admin/calendar/closures'])
    // One tab bar on Mitarbeiter: the list, „Bewerbungen & Hospitationen“ (?tab=applicants) and Krankheitstage.
    const staffTabs = staffAreaTabs(key => key === 'employees.view' || key === 'employees.sickness' || key === 'visits.applicants.view')
    expect(staffTabs.map(tab => [tab.label, tab.to, tab.tab])).toEqual([
      ['Mitarbeitende', '/admin/employees', undefined], ['Bewerbungen & Hospitationen', '/admin/employees', 'applicants'],
      ['Krankheitstage', '/admin/employees/sick-days', undefined],
    ])
    expect(isAreaTabActive(staffTabs[0]!, { path: '/admin/employees', query: {} })).toBe(true)
    expect(isAreaTabActive(staffTabs[0]!, { path: '/admin/employees', query: { tab: 'applicants' } })).toBe(false)
    expect(isAreaTabActive(staffTabs[1]!, { path: '/admin/employees', query: { tab: 'applicants' } })).toBe(true)
    expect(isAreaTabActive(staffTabs[2]!, { path: '/admin/employees/sick-days', query: { year: '2026' } })).toBe(true)
    // The Leitung manages accounts, only the Träger the rights of the roles.
    expect(userTabs(canOf('admin')).map(tab => tab.to)).toEqual(['/admin/users'])
    expect(userTabs(canOf('provider')).map(tab => tab.to)).toEqual(['/admin/users', '/admin/users/rights'])
    expect(staffAreaTabs(key => key === 'employees.view')).toEqual([{ label: 'Mitarbeitende', to: '/admin/employees' }])
  })

  it('sends the old addresses to the tabs, keeping the query and the anchor; old and new address need the same key', () => {
    expect(MOVED_PAGES).toEqual({
      '/admin/closures': '/admin/calendar/closures', '/admin/sick-days': '/admin/employees/sick-days', '/admin/rights': '/admin/users/rights',
    })
    for (const [from, to] of Object.entries(MOVED_PAGES)) {
      expect(movedLocation(to, { query: { year: '2027' }, hash: '#x' }), from).toEqual({ path: to, query: { year: '2027' }, hash: '#x' })
      expect(pageKeys(from), from).toEqual(pageKeys(to))
      // Whoever may not open the tab is not sent there either: the old address answers the same way.
      for (const role of ['admin', 'observer', 'provider'] as const) {
        const viewer = { mustChangePassword: false, can: canOf(role) }
        expect(accountRedirect(from, viewer), `${from} ${role}`).toEqual(accountRedirect(to, viewer))
      }
      // Each old page sends to its tab (the redirect names the map entry).
      expect(page(`${from.slice(1)}.vue`), from).toContain(`movedLocation(MOVED_PAGES['${from}'], to)`)
    }
    // Each tab page carries the tab bar.
    for (const path of ['admin/calendar/index.vue', 'admin/calendar/closures.vue', 'admin/employees/index.vue', 'admin/employees/sick-days.vue', 'admin/users/index.vue', 'admin/users/rights.vue']) {
      expect(page(path), path).toContain('<AreaTabs :tabs=')
    }
  })
})

describe('„Offen für dich“', () => {
  it('lists only the kinds with something open, each with its page', () => {
    expect(openItemLinks(NOTHING)).toEqual([])
    const links = openItemLinks({ knowledge: 2, sign: 3, signOverdue: 1, selfAssessments: 1, leaveDecisions: 1, leaveNotice: true, requirements: 2 })
    expect(links.map(link => [link.label, link.to])).toEqual([
      ['3 Dokumente zu unterschreiben (1 überfällig)', '/my/sign'],
      ['2 Einträge „Gelesen und verstanden“', '/documents?tab=knowledge'],
      ['1 Selbstbeurteilung ausfüllen', '/my/talks'],
      ['Hinweis zu deinem Resturlaub lesen', '/my/leave'],
      ['Rückmeldung zu deinem Urlaubsantrag', '/my/leave'],
      ['2 Pflichttermine überfällig', '/my/requirements'],
    ])
    expect(openItemLinks({ ...NOTHING, sign: 1 })[0]!.label).toBe('1 Dokument zu unterschreiben')
  })

  it('sits on „Mein Dienstplan“ and on the Leitung\'s plan', () => {
    expect(page('my/plan/[year]/[month].vue')).toContain('<OpenItemsCard />')
    expect(page('plan/[year]/[month].vue')).toContain('<OpenItemsCard v-if="isAdmin" />')
  })
})

describe('the tablet\'s start page', () => {
  it('holds every destination as a tile, by frequency, and shows „Kontakte“ only with contacts for the staff', () => {
    const without = tabletStartTiles({ showContacts: false, planPath: '/plan/2026/11' })
    expect(without.map(tile => tile.key)).toEqual(['stamp', 'children', 'documents', 'sign', 'notes', 'plan', 'teamMeetings', 'print'])
    expect(without.filter(tile => tile.big).map(tile => tile.key)).toEqual(['stamp', 'children'])
    expect(without.find(tile => tile.key === 'plan')!.action).toEqual({ kind: 'link', to: '/plan/2026/11' })
    expect(without.find(tile => tile.key === 'documents')).toMatchObject({ label: 'Dokumente', hint: 'Zum Ausdrucken und Wissen', action: { kind: 'link', to: '/documents' } })
    const withContacts = tabletStartTiles({ showContacts: true, planPath: '/plan/2026/11' })
    expect(withContacts.map(tile => tile.key)).toEqual(['stamp', 'children', 'documents', 'sign', 'notes', 'plan', 'teamMeetings', 'contacts', 'print'])
    // Every former header destination is a tile now; the header itself only leads back to the start page.
    const header = navMenu({ role: 'terminal', can: () => false, employeeId: null, isPlanner: false, openCount: 0, unread: 0, today: { year: 2026, month: 11 } })
    expect(header.main.map(entry => entry.to)).toEqual(['/terminal'])
    expect(withContacts.flatMap(tile => (tile.action.kind === 'link' ? [tile.action.to] : []))).toEqual(expect.arrayContaining(['/plan/2026/11', '/team-meetings', '/notes']))
    expect(page('terminal.vue')).toContain('tabletStartTiles({ showContacts: showContacts.value, planPath })')
  })
})
