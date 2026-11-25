import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { calendarTabs, employeeTabs, isAreaTabActive, movedLocation, userTabs } from '../../app/utils/areaTabs'
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
    const staffTabs = employeeTabs(key => key === 'employees.view' || key === 'employees.sickness' || key === 'visits.applicants.view')
    expect(staffTabs.map(tab => [tab.label, tab.to, tab.tab])).toEqual([
      ['Mitarbeiter', '/admin/employees', undefined], ['Bewerbungen & Hospitationen', '/admin/employees', 'applicants'],
      ['Krankheitstage', '/admin/employees/sick-days', undefined],
    ])
    expect(isAreaTabActive(staffTabs[0]!, { path: '/admin/employees', query: {} })).toBe(true)
    expect(isAreaTabActive(staffTabs[0]!, { path: '/admin/employees', query: { tab: 'applicants' } })).toBe(false)
    expect(isAreaTabActive(staffTabs[1]!, { path: '/admin/employees', query: { tab: 'applicants' } })).toBe(true)
    expect(isAreaTabActive(staffTabs[2]!, { path: '/admin/employees/sick-days', query: { year: '2026' } })).toBe(true)
    // The Leitung manages accounts, only the Träger the rights of the roles.
    expect(userTabs(canOf('admin')).map(tab => tab.to)).toEqual(['/admin/users'])
    expect(userTabs(canOf('provider')).map(tab => tab.to)).toEqual(['/admin/users', '/admin/users/rights'])
    expect(employeeTabs(key => key === 'employees.view')).toEqual([{ label: 'Mitarbeiter', to: '/admin/employees' }])
  })

  it('sends the old addresses to the tabs, keeping the query and the anchor', () => {
    expect(movedLocation('/admin/calendar/closures', { query: { year: '2027' }, hash: '#x' }))
      .toEqual({ path: '/admin/calendar/closures', query: { year: '2027' }, hash: '#x' })
    expect(page('admin/closures.vue')).toContain(`definePageMeta({ redirect: to => movedLocation('/admin/calendar/closures', to) })`)
    expect(page('admin/sick-days.vue')).toContain(`definePageMeta({ redirect: to => movedLocation('/admin/employees/sick-days', to) })`)
    expect(page('admin/rights.vue')).toContain(`definePageMeta({ redirect: to => movedLocation('/admin/users/rights', to) })`)
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
      ['2 Pflichttermine fällig', '/my/requirements'],
    ])
    expect(openItemLinks({ ...NOTHING, sign: 1 })[0]!.label).toBe('1 Dokument zu unterschreiben')
  })

  it('sits on „Mein Dienstplan“ and on the Leitung\'s plan', () => {
    expect(page('my/plan/[year]/[month].vue')).toContain('<OpenItemsCard />')
    expect(page('plan/[year]/[month].vue')).toContain('<OpenItemsCard v-if="isAdmin" />')
  })
})

describe('the tablet\'s start page', () => {
  const terminal = page('terminal.vue')
  const start = terminal.slice(terminal.indexOf(`<template v-if="mode === 'start'">`), terminal.indexOf('<template v-else>'))
  it('holds every destination as a tile, by frequency, and shows „Kontakte“ only with contacts for the staff', () => {
    const order = ['setMode(\'stamp\')', 'setMode(\'children\')', 'to="/documents"', 'setMode(\'sign\')', 'to="/notes"', ':to="planPath"', 'to="/team-meetings"', 'to="/contacts"', 'printMenuOpen = true']
    const positions = order.map(marker => start.indexOf(marker))
    expect(positions.every(position => position >= 0), JSON.stringify(positions)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(start).toContain('<NuxtLink v-if="showContacts" to="/contacts"')
    expect(terminal).toContain('const showContacts = computed(() => (tabletContacts.value?.contacts.length ?? 0) > 0)')
  })
})
