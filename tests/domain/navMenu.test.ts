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
    expect(labels(menu.main)).toEqual(['Dienstplan', 'Urlaubsplanung', 'Zeiterfassung', 'Mitarbeiter', 'Kinder', 'Kasse', 'Kalender', 'Teamsitzungen', 'Notizen'])
    expect(menu.main[0]!.to).toBe('/plan/2026/10')
    expect(menu.main[1]!.to).toBe('/admin/leave-planning')
    expect(menu.main[5]!.to).toBe('/cash')
    expect(menu.main[7]!.to).toBe('/team-meetings')
    // „Dokumente“ (tabs Bögen and Vorlagen) where „Vorlagen“ and „Bögen“ were.
    expect(labels(menu.more)).toEqual(['Schließzeiten', 'Krankheitstage', 'Dokumente', 'Kontakte', 'Unfälle', 'Benutzer', 'Einstellungen'])
    expect(menu.more[2]!.to).toBe('/documents')
    expect(menu.more[3]!.to).toBe('/contacts')
    expect(menu.more[4]!.to).toBe('/admin/accidents')
    expect(menu.mine).toEqual([])
    expect(menu.mineCount).toBe(0)
    expect(menu.totalCount).toBe(0)
  })

  it('gives a manager linked to an employee "Meins" with the unread count', () => {
    const menu = navMenu({ ...base, ...as('provider'), employeeId: 7, unread: 2 })
    expect(labels(menu.mine)).toEqual(['Mein Dienstplan (2)', 'Zu unterschreiben', 'Mein Urlaub', 'Meine Termine', 'Meine Gespräche', 'Meine Unfälle'])
    expect(menu.mine.map(entry => entry.to)).toEqual(['/my/plan/2026/10', '/my/sign', '/my/leave', '/my/requirements', '/my/talks', '/my/accidents'])
    expect(menu.mineCount).toBe(2)
    expect(menu.totalCount).toBe(2)
    expect(labels(menu.main)).not.toContain('Mein Dienstplan (2)')
  })

  it('adds "Rechte und Rollen" and "Löschfristen" under "Mehr" for the Träger only', () => {
    const provider = navMenu({ ...base, ...as('provider') })
    expect(labels(provider.more)).toEqual([
      'Schließzeiten', 'Krankheitstage', 'Dokumente', 'Kontakte', 'Unfälle', 'Benutzer', 'Rechte und Rollen', 'Einstellungen',
      'Löschfristen',
    ])
    expect(provider.more[6]!.to).toBe('/admin/rights')
    expect(provider.more[8]!.to).toBe('/admin/retention')
    expect(labels(navMenu(base).more)).not.toContain('Löschfristen')
    expect(labels(navMenu(base).more)).not.toContain('Rechte und Rollen')
  })

  it('puts "Urlaubsplanung" with the open requests second for a planner and counts them in the total', () => {
    const menu = navMenu({ ...base, employeeId: 3, isPlanner: true, openCount: 4, unread: 1 })
    expect(labels(menu.main)).toEqual(['Dienstplan', 'Urlaubsplanung (4)', 'Zeiterfassung', 'Mitarbeiter', 'Kinder', 'Kasse', 'Kalender', 'Teamsitzungen', 'Notizen'])
    expect(menu.totalCount).toBe(5)
    expect(navMenu({ ...base, isPlanner: true }).main[1]!.label).toBe('Urlaubsplanung')
  })

  it('ignores open requests for someone who is no planner', () => {
    const menu = navMenu({ ...base, openCount: 4 })
    expect(labels(menu.main)).not.toContain('Urlaubsplanung (4)')
    expect(menu.totalCount).toBe(0)
  })

  it('shows "Urlaubsplanung" without the count to whoever sees the leave overview (the notice on remaining leave)', () => {
    expect(navMenu({ ...base, openCount: 4 }).main[1]).toEqual({ label: 'Urlaubsplanung', to: '/admin/leave-planning', match: '/admin/leave-planning' })
    expect(labels(navMenu({ ...base, can: key => key !== 'leave.overview' && base.can(key) }).main)).not.toContain('Urlaubsplanung')
  })

  it('gives a Mitarbeiter „Mein Dienstplan“, the plan, the calendar, „Teamsitzungen“ and „Notizen“, the own lists and „Dokumente“ under „Meins“', () => {
    const menu = navMenu({ ...base, ...as('observer'), employeeId: 9, unread: 3 })
    expect(labels(menu.main)).toEqual(['Mein Dienstplan (3)', 'Dienstplan', 'Kalender', 'Teamsitzungen', 'Notizen'])
    expect(menu.main.map(entry => entry.to)).toEqual(['/my/plan/2026/10', '/plan/2026/10', '/my/calendar', '/team-meetings', '/notes'])
    expect(labels(menu.mine)).toEqual(['Zu unterschreiben', 'Mein Urlaub', 'Meine Termine', 'Meine Gespräche', 'Meine Unfälle', 'Dokumente'])
    expect(menu.mine.map(entry => entry.to)).toEqual(['/my/sign', '/my/leave', '/my/requirements', '/my/talks', '/my/accidents', '/documents'])
    expect(menu.more).toEqual([])
    // The unread count stands on „Mein Dienstplan“ in the row, not on „Meins“.
    expect(menu.mineCount).toBe(0)
    expect(menu.totalCount).toBe(3)
    // Without an employee the account belongs to no facility: no team meetings, no notes, no templates.
    const loose = navMenu({ ...base, ...as('observer'), employeeId: null })
    expect(labels(loose.main)).toEqual(['Mein Dienstplan', 'Dienstplan', 'Kalender'])
    expect(labels(loose.mine)).toEqual(['Mein Urlaub', 'Meine Termine', 'Meine Gespräche'])
  })

  it('keeps a Mitarbeiter who may read the templates out of the office menu', () => {
    const menu = navMenu({ ...base, role: 'observer', can: key => key === 'printTemplates.view', employeeId: 9 })
    expect(menu.more).toEqual([])
    expect(labels(menu.main)).toEqual(['Mein Dienstplan', 'Kalender'])
    expect(labels(menu.mine)).toEqual(['Zu unterschreiben', 'Mein Urlaub', 'Meine Termine', 'Meine Gespräche', 'Meine Unfälle', 'Dokumente'])
    expect(menu.mine.at(-1)!.to).toBe('/documents')
  })

  it('counts the open requests to sign at „Zu unterschreiben“ and on „Meins“, only with a linked employee', () => {
    const staff = navMenu({ ...base, ...as('observer'), employeeId: 9, unread: 3, signOpen: 2 })
    expect(labels(staff.mine)[0]).toBe('Zu unterschreiben (2)')
    expect(staff.mineCount).toBe(2)
    expect(staff.totalCount).toBe(5)
    const manager = navMenu({ ...base, ...as('admin'), employeeId: 3, unread: 1, signOpen: 2 })
    expect(labels(manager.mine).slice(0, 2)).toEqual(['Mein Dienstplan (1)', 'Zu unterschreiben (2)'])
    expect(manager.mineCount).toBe(3)
    const loose = navMenu({ ...base, ...as('observer'), employeeId: null, signOpen: 2 })
    expect(labels(loose.mine)).not.toContain('Zu unterschreiben')
    expect(loose.mineCount).toBe(0)
  })

  it('shows „Dokumente“ for „Wissen“ alone, with the entries still to confirm', () => {
    const menu = navMenu({ ...base, role: 'observer', can: key => key === 'knowledge.view', employeeId: 9, knowledgeOpen: 2 })
    expect(menu.mine.at(-1)).toEqual({ label: 'Dokumente (2)', to: '/documents', match: '/documents' })
    expect(navMenu({ ...base, role: 'observer', can: key => key === 'knowledge.view', employeeId: 9 }).mine.at(-1)!.label).toBe('Dokumente')
  })

  it('puts „Dokumente“ under „Mehr“ for an account that maintains the form templates only (tab „Bögen“)', () => {
    const menu = navMenu({ ...base, role: 'observer', can: key => key === 'formTemplates.manage', employeeId: 9 })
    expect(menu.more).toEqual([{ label: 'Dokumente', to: '/documents', match: '/documents' }])
    expect(labels(menu.mine)).not.toContain('Dokumente')
  })

  it('shows „Notizen“ to Leitung and Träger without an employee, to everyone else only with one', () => {
    for (const role of ['admin', 'provider'] as const) {
      expect(navMenu({ ...base, ...as(role) }).main.some(entry => entry.to === '/notes'), role).toBe(true)
    }
    for (const role of ['group_lead', 'observer'] as const) {
      expect(navMenu({ ...base, ...as(role) }).main.some(entry => entry.to === '/notes'), role).toBe(false)
      expect(navMenu({ ...base, ...as(role), employeeId: 5 }).main.some(entry => entry.to === '/notes'), role).toBe(true)
    }
    // Without the key (every role has it by default) there is no entry.
    expect(navMenu({ ...base, can: key => key !== 'notes.view' }).main.some(entry => entry.to === '/notes')).toBe(false)
  })

  it('gives the tablet Stempeln, the plan, the team meetings and the notes', () => {
    const menu = navMenu({ ...base, ...as('terminal'), unread: 5, isPlanner: true, openCount: 2 })
    expect(menu.main.map(entry => entry.to)).toEqual(['/terminal', '/plan/2026/10', '/team-meetings', '/notes'])
    expect(labels(menu.main)).toEqual(['Stempeln', 'Dienstplan', 'Teamsitzungen', 'Notizen'])
    expect(navMenu({ ...base, ...as('terminal'), employeeId: 4 }).main.some(entry => entry.to === '/my/talks')).toBe(false)
    expect(menu.mine).toEqual([])
    expect(menu.more).toEqual([])
    expect(menu.totalCount).toBe(0)
  })
})

describe('„Kontakte“ in the menu', () => {
  it('shows the address book to whoever maintains it, to everyone else only once contacts are marked for the staff', () => {
    const staff = { ...base, ...as('observer'), employeeId: 9 }
    expect(labels(navMenu(staff).mine)).not.toContain('Kontakte')
    expect(navMenu({ ...staff, staffContacts: true }).mine.slice(-2)).toEqual([
      { label: 'Dokumente', to: '/documents', match: '/documents' }, { label: 'Kontakte', to: '/contacts', match: '/contacts' },
    ])
    // A staff account without employee belongs to no facility.
    expect(labels(navMenu({ ...staff, employeeId: null, staffContacts: true }).mine)).not.toContain('Kontakte')
    // The Gruppenleitung (office layout) under „Mehr“, the same way.
    const lead = { ...base, ...as('group_lead'), employeeId: 9 }
    expect(labels(navMenu(lead).more)).toEqual(['Dokumente'])
    expect(labels(navMenu({ ...lead, staffContacts: true }).more)).toEqual(['Dokumente', 'Kontakte'])
    // Leitung and Träger always (they maintain it); the tablet reaches it from its start page.
    expect(labels(navMenu(base).more)).toContain('Kontakte')
    expect(labels(navMenu({ ...base, ...as('terminal'), staffContacts: true }).main)).not.toContain('Kontakte')
  })
})

describe('isEntryActive / isGroupActive', () => {
  const menu = navMenu({ ...base, employeeId: 1 })
  it('matches the entry and pages below it', () => {
    expect(isEntryActive('/plan/2025/3', menu.main[0]!)).toBe(true)
    expect(isEntryActive('/my/plan/2025/3', menu.main[0]!)).toBe(false)
    expect(isEntryActive('/admin/settings/groups/4', menu.more[6]!)).toBe(true)
    expect(isEntryActive('/team-meetings/12', menu.main.at(-2)!)).toBe(true)
    expect(isEntryActive('/documents', menu.more[2]!)).toBe(true)
    expect(isEntryActive('/admin/settingsx', menu.more[6]!)).toBe(false)
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
    ['Notizen', '/notes'],
  ]
  const withPlanning: Pair[] = [officeMain[0]!, ['Urlaubsplanung (4)', '/admin/leave-planning'], ...officeMain.slice(1)]
  // With the leave overview (Leitung, Träger) „Urlaubsplanung“ shows without being a planner: the notice on remaining leave.
  const withOverview: Pair[] = [officeMain[0]!, ['Urlaubsplanung', '/admin/leave-planning'], ...officeMain.slice(1)]
  const leitungMore: Pair[] = [
    // „Dokumente“ replaced „Vorlagen“ and „Bögen“ (one page with both as tabs).
    ['Schließzeiten', '/admin/closures'], ['Krankheitstage', '/admin/sick-days'], ['Dokumente', '/documents'],
    // The address book (contacts.manage).
    ['Kontakte', '/contacts'],
    ['Unfälle', '/admin/accidents'], ['Benutzer', '/admin/users'], ['Einstellungen', '/admin/settings'],
  ]
  const providerMore: Pair[] = [
    ...leitungMore.slice(0, 6), ['Rechte und Rollen', '/admin/rights'], leitungMore[6]!, ['Löschfristen', '/admin/retention'],
  ]
  const officeMine: Pair[] = [
    ['Mein Dienstplan (2)', '/my/plan/2026/10'], ['Zu unterschreiben', '/my/sign'], ['Mein Urlaub', '/my/leave'], ['Meine Termine', '/my/requirements'],
    ['Meine Gespräche', '/my/talks'], ['Meine Unfälle', '/my/accidents'],
  ]
  const staffMain: Pair[] = [['Mein Dienstplan (2)', '/my/plan/2026/10'], ['Dienstplan', '/plan/2026/10'], ['Kalender', '/my/calendar']]
  const staffMainWithMeetings: Pair[] = [...staffMain, ['Teamsitzungen', '/team-meetings'], ['Notizen', '/notes']]
  const staffMine: Pair[] = [['Mein Urlaub', '/my/leave'], ['Meine Termine', '/my/requirements'], ['Meine Gespräche', '/my/talks']]
  // The print templates need a facility, which a staff account only has through its employee.
  const staffMineWithTemplates: Pair[] = [['Zu unterschreiben', '/my/sign'], ...staffMine, ['Meine Unfälle', '/my/accidents'], ['Dokumente', '/documents']]

  const cases: { name: string, viewer: NavViewer, main: Pair[], mine: Pair[], more: Pair[], mineCount: number, totalCount: number }[] = [
    { name: 'Träger', viewer: viewerOf('provider'), main: withOverview, mine: [], more: providerMore, mineCount: 0, totalCount: 0 },
    {
      name: 'Träger with employee, planner', viewer: viewerOf('provider', { employeeId: 7, isPlanner: true }),
      main: withPlanning, mine: officeMine, more: providerMore, mineCount: 2, totalCount: 6,
    },
    { name: 'Leitung', viewer: viewerOf('admin'), main: withOverview, mine: [], more: leitungMore, mineCount: 0, totalCount: 0 },
    {
      name: 'Leitung with employee', viewer: viewerOf('admin', { employeeId: 3 }),
      main: withOverview, mine: officeMine, more: leitungMore, mineCount: 2, totalCount: 2,
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
      // Rechte Teil 3: „Kinder“ with the own account is an office key, so the office layout (own pages under „Meins“,
      // the templates under „Mehr“) with the own calendar view.
      name: 'Gruppenleitung with employee', viewer: viewerOf('group_lead', { employeeId: 9 }),
      main: [
        ['Dienstplan', '/plan/2026/10'], ['Kinder', '/children'], ['Kalender', '/my/calendar'], ['Teamsitzungen', '/team-meetings'],
        ['Notizen', '/notes'],
      ],
      mine: officeMine, more: [['Dokumente', '/documents']], mineCount: 2, totalCount: 2,
    },
    {
      name: 'tablet', viewer: viewerOf('terminal', { employeeId: 4, isPlanner: true }),
      main: [['Stempeln', '/terminal'], ['Dienstplan', '/plan/2026/10'], ['Teamsitzungen', '/team-meetings'], ['Notizen', '/notes']],
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
