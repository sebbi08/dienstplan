import { describe, expect, it } from 'vitest'
import { isEntryActive, isGroupActive, navLabelWithCount, navMenu, type NavViewer } from '../../app/utils/navMenu'
import { effectivePermissions } from '../../shared/domain/permissionBundles'
import { flaggedPermissions } from '../helpers/rights'
import type { Role } from '../../shared/types/api'

/** The role with its default permissions (no per-person flags). */
function as(role: Role): Pick<NavViewer, 'role' | 'can'> {
  const permissions = effectivePermissions({ role })
  return { role, can: key => permissions.has(key) }
}
const base: NavViewer = { ...as('admin'), employeeId: null, isPlanner: false, openCount: 0, unread: 0, today: { year: 2026, month: 10 } }
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
    const menu = navMenu({ ...base, ...as('provider'), employeeId: 7, unread: 2 })
    expect(labels(menu.mine)).toEqual(['Mein Dienstplan (2)', 'Mein Urlaub', 'Meine Termine', 'Meine Gespräche'])
    expect(menu.mine.map(entry => entry.to)).toEqual(['/my/plan/2026/10', '/my/leave', '/my/requirements', '/my/talks'])
    expect(menu.mineCount).toBe(2)
    expect(menu.totalCount).toBe(2)
    expect(labels(menu.main)).not.toContain('Mein Dienstplan (2)')
  })

  it('adds "Rechte und Rollen" and "Löschfristen" under "Mehr" for the Träger only', () => {
    const provider = navMenu({ ...base, ...as('provider') })
    expect(labels(provider.more)).toEqual([
      'Schließzeiten', 'Krankheitstage', 'Vorlagen', 'Bögen', 'Benutzer', 'Rechte und Rollen', 'Einstellungen', 'Löschfristen',
    ])
    expect(provider.more[5]!.to).toBe('/admin/rights')
    expect(provider.more[7]!.to).toBe('/admin/retention')
    expect(labels(navMenu(base).more)).not.toContain('Löschfristen')
    expect(labels(navMenu(base).more)).not.toContain('Rechte und Rollen')
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

  it('gives a Mitarbeiter „Mein Dienstplan“, the plan, the calendar and „Teamsitzungen“, the own lists and „Vorlagen“ under „Meins“', () => {
    const menu = navMenu({ ...base, ...as('observer'), employeeId: 9, unread: 3 })
    expect(labels(menu.main)).toEqual(['Mein Dienstplan (3)', 'Dienstplan', 'Kalender', 'Teamsitzungen'])
    expect(menu.main.map(entry => entry.to)).toEqual(['/my/plan/2026/10', '/plan/2026/10', '/my/calendar', '/team-meetings'])
    expect(labels(menu.mine)).toEqual(['Mein Urlaub', 'Meine Termine', 'Meine Gespräche', 'Vorlagen'])
    expect(menu.mine.map(entry => entry.to)).toEqual(['/my/leave', '/my/requirements', '/my/talks', '/templates'])
    expect(menu.more).toEqual([])
    // The unread count stands on „Mein Dienstplan“ in the row, not on „Meins“.
    expect(menu.mineCount).toBe(0)
    expect(menu.totalCount).toBe(3)
    // Without an employee the account belongs to no facility: no team meetings, no templates.
    const loose = navMenu({ ...base, ...as('observer'), employeeId: null })
    expect(labels(loose.main)).toEqual(['Mein Dienstplan', 'Dienstplan', 'Kalender'])
    expect(labels(loose.mine)).toEqual(['Mein Urlaub', 'Meine Termine', 'Meine Gespräche'])
  })

  it('keeps a Mitarbeiter who may read the templates out of the office menu', () => {
    const menu = navMenu({ ...base, role: 'observer', can: key => key === 'printTemplates.view', employeeId: 9 })
    expect(menu.more).toEqual([])
    expect(labels(menu.main)).toEqual(['Mein Dienstplan', 'Kalender'])
    expect(labels(menu.mine)).toEqual(['Mein Urlaub', 'Meine Termine', 'Meine Gespräche', 'Vorlagen'])
  })

  it('gives the tablet Stempeln, the plan and the team meetings', () => {
    const menu = navMenu({ ...base, ...as('terminal'), unread: 5, isPlanner: true, openCount: 2 })
    expect(menu.main.map(entry => entry.to)).toEqual(['/terminal', '/plan/2026/10', '/team-meetings'])
    expect(labels(menu.main)).toEqual(['Stempeln', 'Dienstplan', 'Teamsitzungen'])
    expect(navMenu({ ...base, ...as('terminal'), employeeId: 4 }).main.some(entry => entry.to === '/my/talks')).toBe(false)
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

/**
 * Rechte und Rollen Teil 1 (RF5): the menu of every role, written down from the role-based menu before it switched to
 * the permissions. `can` comes from the role defaults and today's per-person flags, as the session hands them over.
 */
describe('navMenu per role (unchanged by the permissions)', () => {
  type Pair = [label: string, to: string]
  const pairs = (entries: { label: string, to: string }[]): Pair[] => entries.map(entry => [entry.label, entry.to])
  function viewerOf(role: Role, options: { employeeId?: number | null, isPlanner?: boolean, canEditChildren?: boolean } = {}): NavViewer {
    const isPlanner = options.isPlanner ?? false
    const permissions = flaggedPermissions(role, { canEditChildren: options.canEditChildren, isLeavePlanner: isPlanner })
    return {
      role, can: key => permissions.has(key), employeeId: options.employeeId ?? null, isPlanner, openCount: 4, unread: 2,
      today: { year: 2026, month: 10 },
    }
  }
  const officeMain: Pair[] = [
    ['Dienstplan', '/plan/2026/10'], ['Zeiterfassung', '/admin/time'], ['Mitarbeiter', '/admin/employees'],
    ['Kinder', '/children'], ['Kasse', '/cash'], ['Kalender', '/admin/calendar'], ['Teamsitzungen', '/team-meetings'],
  ]
  const withPlanning: Pair[] = [officeMain[0]!, ['Urlaubsplanung (4)', '/admin/leave-planning'], ...officeMain.slice(1)]
  const leitungMore: Pair[] = [
    ['Schließzeiten', '/admin/closures'], ['Krankheitstage', '/admin/sick-days'], ['Vorlagen', '/templates'],
    ['Bögen', '/admin/forms'], ['Benutzer', '/admin/users'], ['Einstellungen', '/admin/settings'],
  ]
  const providerMore: Pair[] = [
    ...leitungMore.slice(0, 5), ['Rechte und Rollen', '/admin/rights'], leitungMore[5]!, ['Löschfristen', '/admin/retention'],
  ]
  const officeMine: Pair[] = [
    ['Mein Dienstplan (2)', '/my/plan/2026/10'], ['Mein Urlaub', '/my/leave'], ['Meine Termine', '/my/requirements'],
    ['Meine Gespräche', '/my/talks'],
  ]
  const staffMain: Pair[] = [['Mein Dienstplan (2)', '/my/plan/2026/10'], ['Dienstplan', '/plan/2026/10'], ['Kalender', '/my/calendar']]
  const staffMainWithMeetings: Pair[] = [...staffMain, ['Teamsitzungen', '/team-meetings']]
  const staffMine: Pair[] = [['Mein Urlaub', '/my/leave'], ['Meine Termine', '/my/requirements'], ['Meine Gespräche', '/my/talks']]
  // The print templates need a facility, which a staff account only has through its employee.
  const staffMineWithTemplates: Pair[] = [...staffMine, ['Vorlagen', '/templates']]

  const cases: { name: string, viewer: NavViewer, main: Pair[], mine: Pair[], more: Pair[], mineCount: number, totalCount: number }[] = [
    { name: 'Träger', viewer: viewerOf('provider'), main: officeMain, mine: [], more: providerMore, mineCount: 0, totalCount: 0 },
    {
      name: 'Träger with employee, planner', viewer: viewerOf('provider', { employeeId: 7, isPlanner: true }),
      main: withPlanning, mine: officeMine, more: providerMore, mineCount: 2, totalCount: 6,
    },
    { name: 'Leitung', viewer: viewerOf('admin'), main: officeMain, mine: [], more: leitungMore, mineCount: 0, totalCount: 0 },
    {
      name: 'Leitung with employee', viewer: viewerOf('admin', { employeeId: 3 }),
      main: officeMain, mine: officeMine, more: leitungMore, mineCount: 2, totalCount: 2,
    },
    {
      name: 'Leitung as leave planner', viewer: viewerOf('admin', { isPlanner: true }),
      main: withPlanning, mine: [], more: leitungMore, mineCount: 0, totalCount: 4,
    },
    {
      name: 'Leitung as leave planner with employee', viewer: viewerOf('admin', { employeeId: 3, isPlanner: true }),
      main: withPlanning, mine: officeMine, more: leitungMore, mineCount: 2, totalCount: 6,
    },
    { name: 'Mitarbeiter', viewer: viewerOf('observer'), main: staffMain, mine: staffMine, more: [], mineCount: 0, totalCount: 2 },
    {
      name: 'Mitarbeiter with employee', viewer: viewerOf('observer', { employeeId: 9 }),
      main: staffMainWithMeetings, mine: staffMineWithTemplates, more: [], mineCount: 0, totalCount: 2,
    },
    {
      name: 'Mitarbeiter with employee who maintains child records',
      viewer: viewerOf('observer', { employeeId: 9, canEditChildren: true }),
      main: staffMainWithMeetings, mine: staffMineWithTemplates, more: [], mineCount: 0, totalCount: 2,
    },
    {
      // The leave settings never name a Mitarbeiter as planner; the menu does not show the planning to one anyway.
      name: 'Mitarbeiter reported as planner', viewer: viewerOf('observer', { employeeId: 9, isPlanner: true }),
      main: staffMainWithMeetings, mine: staffMineWithTemplates, more: [], mineCount: 0, totalCount: 2,
    },
    {
      name: 'tablet', viewer: viewerOf('terminal', { employeeId: 4, isPlanner: true }),
      main: [['Stempeln', '/terminal'], ['Dienstplan', '/plan/2026/10'], ['Teamsitzungen', '/team-meetings']],
      mine: [], more: [], mineCount: 0, totalCount: 0,
    },
  ]

  it.each(cases)('$name', ({ viewer, main, mine, more, mineCount, totalCount }) => {
    const menu = navMenu(viewer)
    expect(pairs(menu.main)).toEqual(main)
    expect(pairs(menu.mine)).toEqual(mine)
    expect(pairs(menu.more)).toEqual(more)
    expect(menu.mineCount).toBe(mineCount)
    expect(menu.totalCount).toBe(totalCount)
  })
})
