import { describe, expect, it } from 'vitest'
import { isEntryActive, isGroupActive, navLabelWithCount, navMenu, type NavViewer } from '../../app/utils/navMenu'

const base: NavViewer = { role: 'admin', employeeId: null, isPlanner: false, openCount: 0, unread: 0, today: { year: 2026, month: 10 } }
const labels = (entries: { label: string }[]) => entries.map(entry => entry.label)

describe('navMenu', () => {
  it('shows a manager without employee the main entries and "Mehr", no "Meins"', () => {
    const menu = navMenu(base)
    expect(labels(menu.main)).toEqual(['Dienstplan', 'Zeiterfassung', 'Mitarbeiter', 'Kinder', 'Kasse', 'Kalender', 'Teamsitzungen'])
    expect(menu.main[0]!.to).toBe('/plan/2026/10')
    expect(menu.main[4]!.to).toBe('/cash')
    expect(menu.main[6]!.to).toBe('/team-meetings')
    expect(labels(menu.more)).toEqual(['Schließzeiten', 'Krankheitstage', 'Vorlagen', 'Bögen', 'Benutzer', 'Einstellungen'])
    expect(menu.more[3]!.to).toBe('/admin/forms')
    expect(menu.mine).toEqual([])
    expect(menu.mineCount).toBe(0)
    expect(menu.totalCount).toBe(0)
  })

  it('gives a manager linked to an employee "Meins" with the unread count', () => {
    const menu = navMenu({ ...base, role: 'provider', employeeId: 7, unread: 2 })
    expect(labels(menu.mine)).toEqual(['Mein Dienstplan (2)', 'Mein Urlaub', 'Meine Termine', 'Meine Gespräche'])
    expect(menu.mine.map(entry => entry.to)).toEqual(['/my/plan/2026/10', '/my/leave', '/my/requirements', '/my/talks'])
    expect(menu.mineCount).toBe(2)
    expect(menu.totalCount).toBe(2)
    expect(labels(menu.main)).not.toContain('Mein Dienstplan (2)')
  })

  it('puts "Urlaubsplanung" with the open requests second for a planner and counts them in the total', () => {
    const menu = navMenu({ ...base, employeeId: 3, isPlanner: true, openCount: 4, unread: 1 })
    expect(labels(menu.main)).toEqual(['Dienstplan', 'Urlaubsplanung (4)', 'Zeiterfassung', 'Mitarbeiter', 'Kinder', 'Kasse', 'Kalender', 'Teamsitzungen'])
    expect(menu.totalCount).toBe(5)
    expect(navMenu({ ...base, isPlanner: true }).main[1]!.label).toBe('Urlaubsplanung')
  })

  it('ignores open requests for someone who is no planner', () => {
    const menu = navMenu({ ...base, openCount: 4 })
    expect(labels(menu.main)).not.toContain('Urlaubsplanung (4)')
    expect(menu.totalCount).toBe(0)
  })

  it('gives a Mitarbeiter „Mein Dienstplan“, the plan, the calendar and „Teamsitzungen“, the own lists under „Meins“', () => {
    const menu = navMenu({ ...base, role: 'observer', employeeId: 9, unread: 3 })
    expect(labels(menu.main)).toEqual(['Mein Dienstplan (3)', 'Dienstplan', 'Kalender', 'Teamsitzungen'])
    expect(menu.main.map(entry => entry.to)).toEqual(['/my/plan/2026/10', '/plan/2026/10', '/my/calendar', '/team-meetings'])
    expect(labels(menu.mine)).toEqual(['Mein Urlaub', 'Meine Termine', 'Meine Gespräche'])
    expect(menu.mine.map(entry => entry.to)).toEqual(['/my/leave', '/my/requirements', '/my/talks'])
    expect(menu.more).toEqual([])
    // The unread count stands on „Mein Dienstplan“ in the row, not on „Meins“.
    expect(menu.mineCount).toBe(0)
    expect(menu.totalCount).toBe(3)
    // Without an employee the account belongs to no facility: no team meetings.
    expect(labels(navMenu({ ...base, role: 'observer', employeeId: null }).main)).toEqual(['Mein Dienstplan', 'Dienstplan', 'Kalender'])
  })

  it('gives the tablet Stempeln, the plan and the team meetings', () => {
    const menu = navMenu({ ...base, role: 'terminal', unread: 5, isPlanner: true, openCount: 2 })
    expect(menu.main.map(entry => entry.to)).toEqual(['/terminal', '/plan/2026/10', '/team-meetings'])
    expect(labels(menu.main)).toEqual(['Stempeln', 'Dienstplan', 'Teamsitzungen'])
    expect(navMenu({ ...base, role: 'terminal', employeeId: 4 }).main.some(entry => entry.to === '/my/talks')).toBe(false)
    expect(menu.mine).toEqual([])
    expect(menu.more).toEqual([])
    expect(menu.totalCount).toBe(0)
  })
})

describe('isEntryActive / isGroupActive', () => {
  const menu = navMenu({ ...base, employeeId: 1 })
  it('matches the entry and pages below it', () => {
    expect(isEntryActive('/plan/2025/3', menu.main[0]!)).toBe(true)
    expect(isEntryActive('/my/plan/2025/3', menu.main[0]!)).toBe(false)
    expect(isEntryActive('/admin/settings/groups/4', menu.more[5]!)).toBe(true)
    expect(isEntryActive('/team-meetings/12', menu.main.at(-1)!)).toBe(true)
    expect(isEntryActive('/admin/forms', menu.more[3]!)).toBe(true)
    expect(isEntryActive('/admin/settingsx', menu.more[5]!)).toBe(false)
  })
  it('marks "Mehr" and "Meins" active on their pages only', () => {
    expect(isGroupActive('/admin/closures', menu.more)).toBe(true)
    expect(isGroupActive('/admin/time', menu.more)).toBe(false)
    expect(isGroupActive('/my/plan/2026/1', menu.mine)).toBe(true)
    expect(isGroupActive('/plan/2026/1', menu.mine)).toBe(false)
  })
})

describe('navLabelWithCount', () => {
  it('adds the count in brackets only when there is one', () => {
    expect(navLabelWithCount('Meins', 2)).toBe('Meins (2)')
    expect(navLabelWithCount('Meins', 0)).toBe('Meins')
  })
})
