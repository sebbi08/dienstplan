import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const API_DIR = join(process.cwd(), 'server', 'api')

/** Routes any signed-in user (admin or observer) may call; they must check with requireUser(. */
const USER_ROUTES = [
  'auth/password.post.ts',
  'plan/[year]/[month].get.ts',
  'my/plan/[year]/[month].get.ts',
  'my/leave.get.ts',
  'my/time.get.ts',
  'my/time/stamp.post.ts',
  'my/notifications.get.ts',
  'my/notifications/read.post.ts',
  'leave-settings.get.ts',
  'my/leave-requests.get.ts',
  'my/leave-requests.post.ts',
  'my/leave-requests/preview.get.ts',
  'my/leave-requests/[id]/withdraw.post.ts',
  'pdf.get.ts',
  'my/calendar.get.ts',
  'my/requirements.get.ts',
  // The employee's own staff talks (spec Bögen §3): only their own, only released forms.
  'my/talks/index.get.ts', 'my/talks/forms/[formId].get.ts', 'my/talks/forms/[formId].put.ts',
  'my/talks/forms/[formId]/submit.post.ts',
]
/** Routes only the shared stamp tablet may call; they must check with requireTerminal(. */
const TERMINAL_ROUTES = [
  'terminal/status.get.ts', 'terminal/stamp.post.ts', 'terminal/children/unlock.post.ts', 'terminal/children/lock.post.ts',
  'terminal/children/keep-alive.post.ts', 'terminal/children/status.get.ts',
]
/** Routes only the Träger (provider) may call; they must check with requireProvider(. */
const PROVIDER_ROUTES = [
  'employees/[id]/contract.put.ts', 'contract-visibility.put.ts', 'backup.get.ts', 'leave-settings/module.put.ts',
  'facilities.post.ts', 'facilities/[id].put.ts', 'facilities/active.put.ts', 'employees/[id]/facility.put.ts',
  'facilities/[id]/groups.get.ts', 'facilities/[id]/groups.post.ts', 'groups/[id].put.ts', 'groups/[id].delete.ts',
  // The order of the active facility's groups (the Träger, like renaming them).
  'groups/[id]/move.post.ts',
  'facilities/[id]/group-read-access.get.ts', 'children/[id]/facility.put.ts', 'child-retention.get.ts', 'child-retention.put.ts',
  'child-retention/preview.get.ts', 'school-settings.put.ts', 'facilities/[id]/capacity.put.ts',
  'school-settings/auto-leave.put.ts', 'school-settings/auto-leave-preview.get.ts', 'groups/[id]/school-children.put.ts',
  // Staffing ratio: only the Träger changes the state's values (spec Personalschlüssel §5, Review Focus 4).
  'staffing-settings.put.ts', 'staffing-settings.delete.ts',
  // The absence codes (Urlaub, Krank …) apply to every facility: only the Träger changes them.
  'absence-codes/[id].put.ts',
  // Reopening a closed month of a cash box (spec Kasse §6).
  'cash/boxes/[id]/reopen.post.ts',
]
/** Some of the routes for the Leitung (and the Träger) of the active facility; every unlisted route must check with requireAdmin(. */
const ADMIN_ROUTES = [
  'help-outs/candidates.get.ts', 'help-outs/index.post.ts', 'help-outs/[id].delete.ts', 'groups.get.ts',
  'requirement-types.get.ts', 'requirement-types.post.ts', 'requirement-types/[id].put.ts', 'requirement-types/[id].delete.ts',
  'requirements/due.get.ts', 'employees/[id]/requirements.get.ts', 'employees/[id]/requirements.post.ts',
  'employee-requirements/[id].delete.ts', 'employees/[id]/trainings.post.ts', 'employee-trainings/[id].put.ts',
  'employee-trainings/[id].delete.ts',
  'early-sick-leaves/index.get.ts', 'early-sick-leaves/index.put.ts', 'early-sick-leaves/[id].delete.ts',
  'meals/index.get.ts', 'meals/index.post.ts', 'meals/[id].put.ts', 'meals/[id].delete.ts', 'meals/versions/[id].delete.ts',
  'reminder-settings.get.ts', 'reminder-settings.put.ts', 'groups/[id]/documentation.put.ts',
  'time-mark-settings.get.ts', 'time-mark-settings.put.ts',
  // Staffing ratio: the Leitung reads the settings and sets the group type.
  'staffing-settings.get.ts', 'groups/[id]/group-type.put.ts',
  // The monthly Personalschlüssel report of the active facility (Leitung and Träger).
  'staffing/[year]/[month].get.ts',
  // Stamp PINs of the facility's own staff: set, clear and unlock after too many wrong tries.
  'employees/[id]/pin.put.ts', 'employees/[id]/pin.delete.ts', 'employees/[id]/pin/unlock.post.ts',
  // „Zur Kenntnis genommen“ of the plan's warnings and taking it back (staff never see warnings).
  'plan/warning-acks.post.ts', 'plan/warning-acks.delete.ts',
  // „Was noch fehlt“ of the active facility, and hiding / showing its items for all managers of the facility.
  'setup-checklist/index.get.ts', 'setup-checklist/hidden/[key].put.ts', 'setup-checklist/hidden/[key].delete.ts',
  // Cash book (Kasse) of the active facility: boxes, month sheets, entries, transfers, purpose suggestions (spec Kasse §6).
  'cash/boxes.get.ts', 'cash/boxes.post.ts', 'cash/boxes/[id].put.ts', 'cash/boxes/[id].delete.ts',
  'cash/boxes/[id]/[year]/[month].get.ts', 'cash/entries.post.ts', 'cash/entries/[id].put.ts', 'cash/entries/[id].delete.ts',
  'cash/transfers.post.ts', 'cash/transfers/[id].put.ts', 'cash/transfers/[id].delete.ts', 'cash/purposes.get.ts',
  // Closing a month, receipts and the CSV file.
  'cash/boxes/[id]/close.post.ts', 'cash/boxes/[id]/csv.get.ts', 'cash/entries/[id]/receipt.put.ts',
  'cash/entries/[id]/receipt.delete.ts', 'cash/receipts/[id].get.ts',
  // The order of the boxes within the facility or a group.
  'cash/boxes/[id]/move.post.ts',
  // Form templates („Bögen“) of the active facility (spec Bögen §2).
  'form-templates/index.get.ts', 'form-templates/index.post.ts', 'form-templates/[id].put.ts', 'form-templates/[id].delete.ts',
  'form-templates/[id]/copy.post.ts',
  // Staff talks of the active facility (spec Bögen §3).
  'staff-talks/index.get.ts', 'staff-talks/index.post.ts', 'staff-talks/[id].put.ts', 'staff-talks/[id].delete.ts',
  'staff-talks/[id]/forms.post.ts', 'staff-talks/forms/[formId].get.ts', 'staff-talks/forms/[formId].put.ts', 'staff-talks/forms/[formId].delete.ts',
  'staff-talks/forms/[formId]/release.post.ts', 'staff-talks/forms/[formId]/withdraw.post.ts',
  'staff-talks/forms/[formId]/reopen.post.ts', 'staff-talks/forms/[formId]/read-release.post.ts',
]
/**
 * Routes anyone who looks at child records can call (Träger and Leitung with their account, the person who unlocked the
 * tablet; never a Mitarbeiter account); they must check with requireChildReader(.
 */
const CHILD_READER_ROUTES = [
  'care-types/index.get.ts', 'document-types/index.get.ts', 'children/index.get.ts', 'children/planned.get.ts', 'children/birthdays.get.ts', 'children/groups.get.ts',
  'children/open.get.ts', 'children/staff.get.ts', 'children/school-cutoff.get.ts', 'children/[id].get.ts', 'child-documents/[id]/file.get.ts', 'child-documents/overview.get.ts',
  // The Excel-like overview: the tablet lock for staff like the records (spec Übersicht §3).
  'children/overview.get.ts',
  // Attendance: every child viewer reads and writes it (spec Anwesenheit §7).
  'attendance/day.get.ts', 'attendance/arrive.post.ts', 'attendance/leave.post.ts', 'attendance/announcements/index.post.ts',
  'attendance/announcements/[id].delete.ts', 'attendance/absence.put.ts', 'attendance/day.put.ts', 'attendance/stays/[id].put.ts',
  'attendance/stays/[id].delete.ts', 'attendance/history.get.ts', 'attendance/month.get.ts', 'attendance/month-remark.put.ts',
  // Weekly overview of the group books: the service decides per group who reads and who writes.
  'group-book/week.get.ts', 'group-book/week.put.ts', 'group-book/day.put.ts', 'group-book/history.get.ts',
  // Reminders and the development documentation's done/undo: the service decides by the group rights (spec Erinnerungen §2.3).
  'children/reminders.get.ts', 'children/[id]/development-docs.post.ts', 'children/development-docs/[id].delete.ts',
]
/**
 * Routes that maintain child records (managers, and at the tablet Mitarbeiter with the permission); they must check
 * with requireChildEditor(.
 */
const CHILD_EDITOR_ROUTES = [
  'children/index.post.ts', 'children/[id]/master.put.ts', 'children/[id]/health.put.ts',
  'children/[id]/consents.put.ts', 'children/[id]/confirm.post.ts', 'children/[id]/contacts.post.ts', 'children/[id]/contacts/order.post.ts',
  'child-contacts/[id].put.ts', 'child-contacts/[id].delete.ts',
  'children/[id]/documents.post.ts', 'child-documents/[id].put.ts', 'child-documents/[id].delete.ts',
  // Parent meetings: the record section's rights; the service keeps the note to Leitung and Träger (spec Elterngespräche §1).
  'children/[id]/meetings.post.ts', 'children/meetings/[id].put.ts', 'children/meetings/[id].delete.ts',
]
/**
 * The child pages for Träger and Leitung only, at the office or at the unlocked tablet; they must check with
 * requireChildManager(.
 */
const CHILD_MANAGER_ROUTES = [
  'children/[id].delete.ts', 'children/archive.get.ts', 'children/occupancy.get.ts', 'children/school-children.get.ts',
  'children/[id]/group-change.post.ts', 'child-group-changes/[id].put.ts', 'child-group-changes/[id].delete.ts',
  'children/[id]/leave.post.ts', 'children/[id]/unleave.post.ts',
]
/**
 * The print templates to open: Träger, Leitung and the tablet (no unlock, they are no child data), never a Mitarbeiter
 * account; they must check with requireTemplateReader(. Uploading and changing them is requireAdmin(.
 */
const TEMPLATE_READER_ROUTES = ['print-templates/index.get.ts', 'print-templates/[id]/file.get.ts']
/** Routes that need no session at all. */
const PUBLIC_ROUTES = ['health.get.ts', 'auth/login.post.ts']

const routes = (readdirSync(API_DIR, { recursive: true }) as string[])
  .map(file => relative(API_DIR, join(API_DIR, file)).split(sep).join('/'))
  .filter(file => file.endsWith('.ts'))
  .sort()

function source(route: string): string {
  return readFileSync(join(API_DIR, route), 'utf8')
}

describe('API route permissions', () => {
  it('finds the API routes', () => {
    expect(routes.length).toBeGreaterThan(30)
    const others = [
      ...USER_ROUTES, ...TERMINAL_ROUTES, ...PROVIDER_ROUTES, ...CHILD_READER_ROUTES, ...CHILD_EDITOR_ROUTES,
      ...CHILD_MANAGER_ROUTES, ...TEMPLATE_READER_ROUTES, ...PUBLIC_ROUTES,
    ]
    for (const route of others) expect(routes).toContain(route)
    for (const route of ADMIN_ROUTES) {
      expect(routes).toContain(route)
      expect(others).not.toContain(route)
    }
  })

  it.each(routes)('%s is protected as classified', (route) => {
    const code = source(route)
    if (PUBLIC_ROUTES.includes(route)) {
      expect(code).not.toMatch(/require(Admin|User|Terminal|Provider|ChildReader|ChildEditor|ChildManager|TemplateReader)\(/)
    }
    else if (TEMPLATE_READER_ROUTES.includes(route)) {
      expect(code).toContain('requireTemplateReader(')
    }
    else if (CHILD_READER_ROUTES.includes(route)) {
      expect(code).toContain('requireChildReader(')
    }
    else if (CHILD_EDITOR_ROUTES.includes(route)) {
      expect(code).toContain('requireChildEditor(')
    }
    else if (CHILD_MANAGER_ROUTES.includes(route)) {
      expect(code).toContain('requireChildManager(')
    }
    else if (PROVIDER_ROUTES.includes(route)) {
      expect(code).toContain('requireProvider(')
    }
    else if (TERMINAL_ROUTES.includes(route)) {
      expect(code).toContain('requireTerminal(')
    }
    else if (USER_ROUTES.includes(route)) {
      expect(code).toContain('requireUser(')
    }
    else {
      expect(code, 'new routes must call requireAdmin( or be added to the allowlists').toContain('requireAdmin(')
    }
  })

  it('opens the mandatory appointments to managers only, apart from the read-only own view', () => {
    const touching = routes.filter(route => /requirement|training/i.test(route) || source(route).includes('services/requirements\''))
    expect(touching).toHaveLength(12)
    for (const route of touching) {
      const code = source(route)
      if (route === 'my/requirements.get.ts') {
        // The own view takes nothing from the request: whose records it shows follows from the session alone.
        expect(code).toContain('requireUser(')
        expect(code).toContain('getMyRequirements(')
        expect(code).not.toMatch(/getRouterParam|getValidated|readValidatedBody|readBody|getQuery/)
      }
      else {
        expect(ADMIN_ROUTES, route).toContain(route)
        expect(code, route).toContain('requireAdmin(')
        expect(code, route).not.toMatch(/require(User|Provider|Terminal)\(/)
        expect(code, route).toContain('.facilityId')
      }
    }
  })

  it('opens the meal settings to managers of the active facility only', () => {
    const touching = routes.filter(route => /^meals\//.test(route) || source(route).includes('services/meals\''))
    expect(touching).toEqual(['meals/[id].delete.ts', 'meals/[id].put.ts', 'meals/index.get.ts', 'meals/index.post.ts',
      'meals/versions/[id].delete.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens the cash book to managers of the active facility only (staff and tablet 403)', () => {
    const touching = routes.filter(route => /^cash\//.test(route) || /services\/cash\w*'/.test(source(route)))
    expect(touching.length).toBeGreaterThanOrEqual(12)
    for (const route of touching) {
      const code = source(route)
      // Only reopening a closed month is the Träger's (spec Kasse §6).
      if (PROVIDER_ROUTES.includes(route)) {
        expect(code, route).toContain('requireProvider(')
        continue
      }
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager|TemplateReader)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens the staff talks to managers of the active facility, and only the own released forms to the employee', () => {
    const touching = routes.filter(route => /^(staff-talks|my\/talks)\//.test(route) || source(route).includes('services/staffTalks\''))
    expect(touching).toHaveLength(16)
    for (const route of touching) {
      const code = source(route)
      if (route.startsWith('my/talks/')) {
        // Whose talks follows from the session alone; the tablet is refused by requireUser (no allowTerminal).
        expect(USER_ROUTES, route).toContain(route)
        expect(code, route).toContain('requireUser(event)')
        expect(code, route).not.toMatch(/allowTerminal|employeeId|getQuery|require(Admin|Provider|Terminal)\(/)
      }
      else {
        expect(ADMIN_ROUTES, route).toContain(route)
        expect(code, route).toContain('requireAdmin(')
        expect(code, route).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager|TemplateReader)\(/)
        expect(code, route).toContain('admin.facilityId')
      }
    }
  })

  it('opens the form templates to managers of the active facility only (staff and tablet 403)', () => {
    const touching = routes.filter(route => /^form-templates\//.test(route) || source(route).includes('services/formTemplates\''))
    expect(touching).toEqual(['form-templates/[id].delete.ts', 'form-templates/[id].put.ts', 'form-templates/[id]/copy.post.ts',
      'form-templates/index.get.ts', 'form-templates/index.post.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager|TemplateReader)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('lets only the Träger change the staffing overrides; managers read them in their active facility', () => {
    const touching = routes.filter(route => source(route).includes('services/staffing\''))
    expect(touching).toEqual(['staffing-settings.delete.ts', 'staffing-settings.get.ts', 'staffing-settings.put.ts'])
    for (const route of ['staffing-settings.delete.ts', 'staffing-settings.put.ts']) {
      const code = source(route)
      expect(PROVIDER_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireProvider(')
      expect(code, route).toContain('requireFacility(')
      expect(code, route).not.toMatch(/require(Admin|User)\(/)
    }
    const read = source('staffing-settings.get.ts')
    expect(ADMIN_ROUTES).toContain('staffing-settings.get.ts')
    expect(read).toContain('requireAdmin(')
    expect(read).toContain('admin.facilityId')
  })

  it('lets managers of the active facility set, clear and unlock stamp PINs', () => {
    const touching = routes.filter(route => /\b(setPin|clearPin|unlockPin)\(/.test(source(route)))
    expect(touching).toEqual(['employees/[id]/pin.delete.ts', 'employees/[id]/pin.put.ts', 'employees/[id]/pin/unlock.post.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('lets only the Träger change the absence codes', () => {
    const touching = routes.filter(route => /^absence-codes\//.test(route) || /\bupdateCode\b/.test(source(route)))
    expect(touching).toEqual(['absence-codes/[id].put.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(PROVIDER_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireProvider(')
      expect(code, route).not.toMatch(/require(Admin|User|Terminal|ChildReader|ChildEditor|ChildManager)\(/)
    }
  })

  it('opens the monthly staffing report to managers of the active facility only', () => {
    const touching = routes.filter(route => source(route).includes('services/staffingReport\''))
    expect(touching).toEqual(['staffing/[year]/[month].get.ts'])
    const code = source('staffing/[year]/[month].get.ts')
    expect(code).toContain('requireAdmin(')
    expect(code).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager)\(/)
    expect(code).toContain('admin.facilityId')
  })

  it('opens the reminder settings to managers of the active facility only', () => {
    const touching = routes.filter(route => source(route).includes('services/reminderSettings\''))
    expect(touching).toEqual(['groups/[id]/documentation.put.ts', 'reminder-settings.get.ts', 'reminder-settings.put.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens the markers for falling ill during duty to managers of the active facility only', () => {
    const touching = routes.filter(route => /sick-leave/i.test(route) || source(route).includes('services/earlySickLeaves\''))
    expect(touching).toEqual(['early-sick-leaves/[id].delete.ts', 'early-sick-leaves/index.get.ts', 'early-sick-leaves/index.put.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens planned group changes to managers of the active facility only', () => {
    const touching = routes.filter(route => /group-change/i.test(route) || source(route).includes('services/childGroupChanges\''))
    expect(touching).toEqual(['child-group-changes/[id].delete.ts', 'child-group-changes/[id].put.ts', 'children/[id]/group-change.post.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(CHILD_MANAGER_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireChildManager(')
      expect(code, route).not.toMatch(/require(User|Admin|Provider|Terminal|ChildReader|ChildEditor)\(/)
      expect(code, route).toContain('manager.facilityId')
    }
  })

  it('checks with requireChildManager( on exactly the child pages for managers', () => {
    const managing = routes.filter(route => source(route).includes('requireChildManager('))
    expect(managing).toEqual([...CHILD_MANAGER_ROUTES].sort())
    for (const route of CHILD_MANAGER_ROUTES) {
      expect(source(route), route).not.toMatch(/require(User|Admin|Provider|Terminal|ChildReader|ChildEditor)\(/)
    }
  })

  it('keeps the Träger move and the settings of child records away from the tablet', () => {
    for (const route of ['children/[id]/facility.put.ts', 'child-retention/preview.get.ts']) {
      expect(source(route), route).toContain('requireProvider(')
    }
    for (const route of ['care-types/index.post.ts', 'care-types/[id].put.ts', 'care-types/[id].delete.ts',
      'document-types/index.post.ts', 'document-types/[id].put.ts', 'document-types/[id].delete.ts',
      'attendance-settings.get.ts', 'attendance-settings.put.ts']) {
      expect(source(route), route).toContain('requireAdmin(')
    }
  })

  it('leaves the automatic leaving of school children, its preview and the group flag to the Träger', () => {
    const settings = ['school-settings/auto-leave-preview.get.ts', 'school-settings/auto-leave.put.ts']
    for (const route of [...settings, 'groups/[id]/school-children.put.ts']) {
      const code = source(route)
      expect(PROVIDER_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireProvider(')
      expect(code, route).not.toMatch(/require(User|Admin|Terminal|ChildReader|ChildEditor)\(/)
    }
    // The switch and its preview are those of the facility the Träger works in.
    for (const route of settings) expect(source(route), route).toContain('requireFacility(event, provider)')
    // The preview and the daily run share one selection: the route must not build its own.
    expect(source('school-settings/auto-leave-preview.get.ts')).toContain('schoolLeavers(')
  })

  it('leaves the order of the groups to the Träger, in the facility they work in', () => {
    const code = source('groups/[id]/move.post.ts')
    expect(code).toContain('requireProvider(')
    expect(code).toContain('requireFacility(event, provider)')
    expect(code).not.toMatch(/require(User|Admin|Terminal|ChildReader|ChildEditor)\(/)
  })

  it('opens the list of the coming school children to managers of the active facility only', () => {
    const code = source('children/school-children.get.ts')
    expect(code).toContain('requireChildManager(')
    expect(code).not.toMatch(/require(User|Admin|Provider|Terminal|ChildReader|ChildEditor)\(/)
    expect(code).toContain('manager.facilityId')
  })

  it('lets the tablet open the print templates, but only managers of the active facility change them', () => {
    const touching = routes.filter(route => /^print-templates\//.test(route) || source(route).includes('services/printTemplates\''))
    expect(touching).toEqual(['print-templates/[id].delete.ts', 'print-templates/[id].put.ts', 'print-templates/[id]/file.get.ts',
      'print-templates/[id]/file.put.ts', 'print-templates/index.get.ts', 'print-templates/index.post.ts'])
    for (const route of touching) {
      const code = source(route)
      if (TEMPLATE_READER_ROUTES.includes(route)) {
        expect(code, route).toContain('requireTemplateReader(')
        expect(code, route).not.toMatch(/require(User|Admin|Provider|Terminal|ChildReader|ChildEditor|ChildManager)\(/)
      }
      else {
        expect(code, route).toContain('requireAdmin(')
        expect(code, route).not.toMatch(/require(User|Provider|Terminal|TemplateReader|ChildReader|ChildEditor|ChildManager)\(/)
      }
    }
    // The guard admits the tablet without an unlock, and decides the rest with the tested service function.
    const auth = readFileSync(join(process.cwd(), 'server', 'utils', 'auth.ts'), 'utf8')
    expect(auth).toMatch(/requireTemplateReader[\s\S]*?allowTerminal: true[\s\S]*?templateReaderFacility\(user\)/)
  })

  it('keeps the tablet\'s unlock token in the server-only part of the session', () => {
    // Routes go through childUnlockToken( / storeChildUnlockToken( instead of touching the session field.
    for (const route of routes) expect(source(route), route).not.toMatch(/childUnlock(?!Token)/)
    const auth = readFileSync(join(process.cwd(), 'server', 'utils', 'auth.ts'), 'utf8')
    expect(auth).toContain('setUserSession(event, { secure: { childUnlock: token } })')
    expect(auth).toContain('.secure?.childUnlock')
  })

  it('lets the tablet into the general plan only', () => {
    const allowing = routes.filter(route => source(route).includes('allowTerminal: true'))
    expect(allowing).toEqual(['plan/[year]/[month].get.ts'])
  })
})
