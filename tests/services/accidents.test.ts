import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeePayroll, employees, entries, formAttachments, formTemplates, timeRecords } from '../../server/db/schema'
import type { ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import {
  accidentReminders, addChildAccidentAttachment, addEmployeeAccidentAttachment, createChildAccident, createEmployeeAccident,
  createMyAccident, deleteChildAccident, deleteChildAccidentAttachment, deleteEmployeeAccident, getChildAccident,
  getEmployeeAccident, listAccidentOverview, listChildAccidents, listEmployeeAccidents, listMyAccidents,
  moveEmployeeAccidents, readChildAccidentAttachment, readEmployeeAccidentAttachment, saveChildAccident,
  saveEmployeeAccident, type AccidentActor,
} from '../../server/services/accidents'
import { listReminders } from '../../server/services/reminders'
import { u1000Fields } from '../../shared/domain/accidents'
import type { FormContent } from '../../shared/domain/forms'
import type { AccidentFormDto, SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-11-18T09:00:00Z')
const LATER = new Date('2026-11-18T10:00:00Z')
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])
const PDF = Buffer.from('%PDF-1.4 test')

/** "<status> <code>" of the ServiceError fn throws, or null if it does not throw. */
function failure(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return `${error.statusCode} ${error.code}`
    throw error
  }
}

const header = { date: '2026-11-17', start: 600, doctor: false, unfit: false, reportedOn: null }

let db: Db
let groupA: number
let groupB: number
let anna: number
let berta: number
let kid: number
let otherGroupKid: number
let childTemplate: number
let u1000Template: number
let leitung: ChildViewer
let leitungUser: SessionUser
let traegerUser: SessionUser
let annaUser: SessionUser
let bertaUser: SessionUser
/** Anna at the tablet: a Mitarbeiter account, group A her own, group B only to read. */
let annaTablet: ChildViewer
/** Berta at the tablet without an account. */
let bertaTablet: ChildViewer

const manager = (user: SessionUser): AccidentActor => ({ user, facilityId: user.facilityId })
const self = (user: SessionUser): AccidentActor => ({ user, facilityId: null })
const templateOf = (key: string, facilityId = 1) => db.select({ id: formTemplates.id }).from(formTemplates)
  .where(and(eq(formTemplates.facilityId, facilityId), eq(formTemplates.starterKey, key))).get()!.id
const itemsOf = (form: AccidentFormDto) => form.content.sections.flatMap(section => section.items)
const fieldAnswer = (form: AccidentFormDto, number: number) => {
  const item = u1000Fields(form.content as FormContent).fields.get(number)![0]!
  return form.answers[item.id]
}

beforeEach(() => {
  db = createTestDb()
  groupA = addGroup(db, 1, 'Bären')
  groupB = addGroup(db, 1, 'Füchse')
  anna = addEmployee(db, 'Anna Muster', { groupId: groupA })
  berta = addEmployee(db, 'Berta', { groupId: groupA })
  annaUser = addUser(db, 'anna', 'observer', anna)
  bertaUser = addUser(db, 'berta', 'observer', berta)
  leitungUser = addUser(db, 'leitung', 'admin')
  traegerUser = addUser(db, 'traeger', 'provider')
  leitung = asChildViewer(leitungUser)
  const tablet = {
    visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: { own: groupA, readable: [groupB] },
    role: 'observer' as const, permissions: permissionsOf('observer'), facilityId: 1,
  }
  annaTablet = { id: annaUser.id, employeeId: anna, name: 'Anna Muster', ...tablet }
  bertaTablet = { id: null, employeeId: berta, name: 'Berta', ...tablet }
  kid = addChild(db, 1, { firstName: 'Lena', lastName: 'Kurz', birthDate: '2022-03-04', groupId: groupA })
  otherGroupKid = addChild(db, 1, { firstName: 'Ida', groupId: groupB })
  childTemplate = templateOf('accident_child')
  u1000Template = templateOf('accident_u1000')
})

describe('accident reports about a child', () => {
  it('whoever keeps the attendance fills one in at the tablet; author and Leitung edit, only Leitung/Träger delete', () => {
    const byBerta = createChildAccident(db, bertaTablet, kid, { templateId: childTemplate, ...header, doctor: true }, NOW)
    expect(getChildAccident(db, bertaTablet, byBerta, NOW)).toMatchObject({
      subject: 'child', childId: kid, employeeId: null, personName: 'Lena Kurz', title: 'Unfallbericht Kind', date: '2026-11-17',
      start: 600, doctor: true, unfit: false, reportedOn: null, printLayout: null, right: 'edit', canDelete: false, updatedBy: 'Berta',
    })
    // Anna writes reports of her own, but Berta's she only reads.
    expect(getChildAccident(db, annaTablet, byBerta, NOW).right).toBe('read')
    const loaded = getChildAccident(db, leitung, byBerta, NOW)
    expect(loaded).toMatchObject({ right: 'edit', canDelete: true })
    const input = { ...header, doctor: true, reportedOn: '2026-11-18', answers: {}, expectedUpdatedAt: loaded.updatedAt }
    expect(failure(() => saveChildAccident(db, annaTablet, byBerta, input, LATER))).toBe('403 forbidden')
    expect(saveChildAccident(db, bertaTablet, byBerta, input, LATER)).toEqual({ updatedAt: LATER.toISOString(), updatedBy: 'Berta' })
    expect(getChildAccident(db, leitung, byBerta, LATER).reportedOn).toBe('2026-11-18')

    expect(failure(() => deleteChildAccident(db, bertaTablet, byBerta, LATER))).toBe('403 forbidden')
    expect(failure(() => deleteChildAccident(db, annaTablet, byBerta, LATER))).toBe('403 forbidden')
    deleteChildAccident(db, leitung, byBerta, LATER)
    expect(listChildAccidents(db, leitung, kid, LATER).forms).toEqual([])
  })

  it('lists newest first with the active child templates for whoever may fill one in', () => {
    createChildAccident(db, annaTablet, kid, { templateId: childTemplate, ...header, date: '2026-11-01' }, NOW)
    const newer = createChildAccident(db, leitung, kid, { templateId: childTemplate, ...header }, NOW)
    const list = listChildAccidents(db, annaTablet, kid, NOW)
    expect(list.forms.map(form => [form.id === newer, form.date, form.right])).toEqual([[true, '2026-11-17', 'read'], [false, '2026-11-01', 'edit']])
    expect(list.canCreate).toBe(true)
    expect(list.templates).toEqual([{ id: childTemplate, name: 'Unfallbericht Kind' }])
  })

  it('checks the header: date required and not in the future, „arbeitsunfähig“ only for employees, a valid „gemeldet am“', () => {
    const create = (patch: object) => failure(() => createChildAccident(db, leitung, kid, { templateId: childTemplate, ...header, ...patch }, NOW))
    expect(create({ date: '' })).toBe('400 accident_date_invalid')
    expect(create({ date: '2026-02-30' })).toBe('400 accident_date_invalid')
    expect(create({ date: '2026-11-19' })).toBe('400 accident_date_invalid')
    expect(create({ date: '2026-11-18' })).toBeNull()
    expect(create({ start: 1440 })).toBe('400 accident_start_invalid')
    expect(create({ unfit: true })).toBe('400 accident_unfit_employee_only')
    expect(create({ reportedOn: 'gestern' })).toBe('400 accident_reported_invalid')
    // An employee template is no choice for a child, nor an archived one.
    expect(create({ templateId: u1000Template })).toBe('404 form_template_not_found')
    db.update(formTemplates).set({ archived: true }).where(eq(formTemplates.id, childTemplate)).run()
    expect(create({})).toBe('409 form_template_archived')
  })

  it('a group the viewer only reads is not writable at the tablet; a hidden child or another facility\'s report is 404', () => {
    expect(listChildAccidents(db, annaTablet, otherGroupKid, NOW)).toMatchObject({ canCreate: false, templates: [] })
    expect(failure(() => createChildAccident(db, annaTablet, otherGroupKid, { templateId: childTemplate, ...header }, NOW)))
      .toBe('403 group_read_only')
    const theirs = createChildAccident(db, leitung, otherGroupKid, { templateId: childTemplate, ...header }, NOW)
    expect(getChildAccident(db, annaTablet, theirs, NOW).right).toBe('read')

    const onlyOwn = { ...annaTablet, groups: { own: groupA, readable: [] } }
    expect(failure(() => getChildAccident(db, onlyOwn, theirs, NOW))).toBe('404 form_not_found')
    expect(failure(() => listChildAccidents(db, onlyOwn, otherGroupKid, NOW))).toBe('404 child_not_found')

    const other = addFacility(db, 'Zweite')
    const leitung2 = asChildViewer(addUser(db, 'leitung2', 'admin', null, other))
    expect(failure(() => getChildAccident(db, leitung2, theirs, NOW))).toBe('404 form_not_found')
    expect(failure(() => deleteChildAccident(db, leitung2, theirs, NOW))).toBe('404 form_not_found')
    // A viewer without the attendance (a role setting without it) writes none.
    const noAttendance = { ...annaTablet, permissions: new Set([...annaTablet.permissions].filter(key => key !== 'children.attendance')) }
    expect(failure(() => createChildAccident(db, noAttendance, kid, { templateId: childTemplate, ...header }, NOW))).toBe('403 forbidden')
  })

  it('prefills the child\'s name, birth date and group where the template asks for them', () => {
    const items = JSON.parse(db.select().from(formTemplates).where(eq(formTemplates.id, childTemplate)).get()!.content) as FormContent
    items.sections[0]!.items.push(
      { id: 'n', kind: 'text', question: 'Name', prefill: 'personName' }, { id: 'b', kind: 'date', question: 'Geb.', prefill: 'birthDate' },
      { id: 'g', kind: 'text', question: 'Gruppe', prefill: 'group' },
    )
    db.update(formTemplates).set({ content: JSON.stringify(items) }).where(eq(formTemplates.id, childTemplate)).run()
    const id = createChildAccident(db, annaTablet, kid, { templateId: childTemplate, ...header }, NOW)
    expect(getChildAccident(db, annaTablet, id, NOW).answers).toEqual({ n: 'Lena Kurz', b: '2022-03-04', g: 'Bären' })
  })

  it('attachments: JPG/PNG/PDF up to 10 MB by whoever may change the report; read by whoever reads it', () => {
    const id = createChildAccident(db, annaTablet, kid, { templateId: childTemplate, ...header }, NOW)
    const photo = addChildAccidentAttachment(db, annaTablet, id, { data: PNG, filename: 'C:\\fotos\\knie.png' }, NOW)
    addChildAccidentAttachment(db, leitung, id, { data: PDF, filename: 'Arztbrief.pdf' }, NOW)
    expect(getChildAccident(db, leitung, id, NOW).attachments.map(file => [file.fileName, file.mimeType, file.uploadedByName]))
      .toEqual([['knie.png', 'image/png', 'Anna Muster'], ['Arztbrief.pdf', 'application/pdf', 'leitung']])
    expect(failure(() => addChildAccidentAttachment(db, annaTablet, id, { data: Buffer.from('hallo'), filename: 'a.txt' }, NOW)))
      .toBe('400 document_type_invalid')
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1)
    PNG.copy(big)
    expect(failure(() => addChildAccidentAttachment(db, annaTablet, id, { data: big, filename: 'gross.png' }, NOW))).toBe('413 document_too_large')
    // Berta reads Anna's report but may not change it.
    expect(failure(() => addChildAccidentAttachment(db, bertaTablet, id, { data: PNG, filename: 'x.png' }, NOW))).toBe('403 forbidden')
    expect(readChildAccidentAttachment(db, bertaTablet, photo, NOW)).toMatchObject({ mimeType: 'image/png', fileName: 'knie.png' })
    expect(failure(() => deleteChildAccidentAttachment(db, bertaTablet, photo, NOW))).toBe('403 forbidden')
    deleteChildAccidentAttachment(db, annaTablet, photo, NOW)
    expect(getChildAccident(db, leitung, id, NOW).attachments).toHaveLength(1)

    const leitung2 = asChildViewer(addUser(db, 'leitung2', 'admin', null, addFacility(db, 'Zweite')))
    const pdf = getChildAccident(db, leitung, id, NOW).attachments[0]!.id
    expect(failure(() => readChildAccidentAttachment(db, leitung2, pdf, NOW))).toBe('404 attachment_not_found')
    // Deleting the report takes its attachments along.
    deleteChildAccident(db, leitung, id, NOW)
    expect(db.select().from(formAttachments).all()).toEqual([])
  })
})

describe('accident reports about an employee', () => {
  beforeEach(() => {
    db.update(employees).set({
      birthYear: 1990, birthday: '05-06', street: 'Hauptstr. 1', postalCode: '12345', city: 'Musterstadt', jobKey: 'educator',
      employedSince: '2020-08-01', qualification: 'fachkraft',
    }).where(eq(employees.id, anna)).run()
    db.insert(employeePayroll).values({ employeeId: anna, healthInsurer: 'AOK Musterstadt' }).run()
    db.insert(entries).values({
      employeeId: anna, date: '2026-11-17', kind: 'shift', start: 450, end: 930, homeOffice: true, updatedAt: NOW.toISOString(),
    }).run()
  })

  it('the U 1000 is prefilled with what the acting person may read: the Leitung without payroll gets no health insurer', () => {
    const id = createEmployeeAccident(db, manager(leitungUser), anna, { templateId: u1000Template, ...header, unfit: true }, NOW)
    const form = getEmployeeAccident(db, manager(leitungUser), id)
    expect(form).toMatchObject({ subject: 'employee', employeeId: anna, personName: 'Anna Muster', unfit: true, printLayout: 'u1000', right: 'edit', canDelete: true })
    expect(String(fieldAnswer(form, 1)).split('\n')[0]).toBe(form.facilityName)
    expect(fieldAnswer(form, 4)).toBe('Anna Muster')
    expect(fieldAnswer(form, 5)).toBe('1990-05-06')
    expect(fieldAnswer(form, 6)).toBe('Hauptstr. 1\n12345 Musterstadt')
    expect(fieldAnswer(form, 13)).toBeUndefined()
    // Contract data (job title, „seit“) only with employees.contractView: the Leitung gets the qualification instead.
    expect(fieldAnswer(form, 24)).toBe('Fachkraft')
    expect(fieldAnswer(form, 25)).toBeUndefined()
    expect(fieldAnswer(form, 23)).toBe('Beginn 07:30 Uhr, Ende 15:30 Uhr')
    expect(fieldAnswer(form, 26)).toBe('Bären')
    const homeOffice = u1000Fields(form.content).fields.get(17)![0]!
    expect(form.answers[homeOffice.id]).toEqual([homeOffice.kind === 'choices' ? homeOffice.options[1]!.id : ''])

    const byTraeger = getEmployeeAccident(db, manager(traegerUser), createEmployeeAccident(db, manager(traegerUser), anna, { templateId: u1000Template, ...header }, NOW))
    expect(fieldAnswer(byTraeger, 13)).toBe('AOK Musterstadt')
    expect(fieldAnswer(byTraeger, 24)).toBe('Erzieher/in')
    expect(fieldAnswer(byTraeger, 25)).toBe('2020-08-01')
  })

  it('the stamped time beats the plan; the facility\'s name, address and phone are filled in', () => {
    db.insert(timeRecords).values({ employeeId: anna, date: '2026-11-17', start: 460, end: 900, source: 'terminal', createdAt: NOW.toISOString() }).run()
    const id = createMyAccident(db, annaUser, { templateId: u1000Template, ...header }, NOW)
    const form = getEmployeeAccident(db, self(annaUser), id)
    expect(fieldAnswer(form, 23)).toBe('Beginn 07:40 Uhr, Ende 15:00 Uhr')
    expect(String(fieldAnswer(form, 1)).split('\n')[0]).toBe(form.facilityName)
  })

  it('the employee fills in one about themselves (all own data prefilled), edits it, never deletes; reads the Leitung\'s', () => {
    const own = createMyAccident(db, annaUser, { templateId: u1000Template, ...header, doctor: true }, NOW)
    const form = getEmployeeAccident(db, self(annaUser), own)
    expect(form).toMatchObject({ right: 'edit', canDelete: false })
    expect(fieldAnswer(form, 13)).toBe('AOK Musterstadt')
    expect(fieldAnswer(form, 25)).toBe('2020-08-01')
    const saved = saveEmployeeAccident(db, self(annaUser), own, { ...header, unfit: true, answers: form.answers, expectedUpdatedAt: form.updatedAt }, LATER)
    expect(saved.updatedBy).toBe('Anna Muster')
    expect(failure(() => deleteEmployeeAccident(db, self(annaUser), own))).toBe('403 forbidden')

    const byLeitung = createEmployeeAccident(db, manager(leitungUser), anna, { templateId: u1000Template, ...header }, NOW)
    expect(getEmployeeAccident(db, self(annaUser), byLeitung).right).toBe('read')
    expect(listMyAccidents(db, annaUser).forms.map(item => [item.id, item.right])).toEqual([[byLeitung, 'read'], [own, 'edit']].sort((a, b) => Number(b[0]) - Number(a[0])))
    // The Leitung changes and deletes the employee's own report as well.
    expect(getEmployeeAccident(db, manager(leitungUser), own)).toMatchObject({ right: 'edit', canDelete: true })
    deleteEmployeeAccident(db, manager(leitungUser), own)
    expect(listEmployeeAccidents(db, manager(leitungUser), anna).forms.map(item => item.id)).toEqual([byLeitung])
  })

  it('another employee, a Mitarbeiter without the right and another facility get nothing', () => {
    const id = createMyAccident(db, annaUser, { templateId: u1000Template, ...header }, NOW)
    expect(failure(() => getEmployeeAccident(db, self(bertaUser), id))).toBe('404 form_not_found')
    expect(failure(() => saveEmployeeAccident(db, self(bertaUser), id, { ...header, answers: {}, expectedUpdatedAt: '' }))).toBe('404 form_not_found')
    expect(failure(() => listEmployeeAccidents(db, manager(bertaUser), anna))).toBe('403 forbidden')
    expect(failure(() => createEmployeeAccident(db, manager(bertaUser), anna, { templateId: u1000Template, ...header }, NOW))).toBe('403 forbidden')
    const other = addFacility(db, 'Zweite')
    const leitung2 = addUser(db, 'leitung2', 'admin', null, other)
    expect(failure(() => getEmployeeAccident(db, manager(leitung2), id))).toBe('404 form_not_found')
    expect(failure(() => listEmployeeAccidents(db, manager(leitung2), anna))).toBe('404 employee_not_found')
    const file = addEmployeeAccidentAttachment(db, self(annaUser), id, { data: PNG, filename: 'bein.png' }, NOW)
    expect(readEmployeeAccidentAttachment(db, self(annaUser), file).mimeType).toBe('image/png')
    expect(failure(() => readEmployeeAccidentAttachment(db, manager(leitung2), file))).toBe('404 attachment_not_found')
    expect(failure(() => readEmployeeAccidentAttachment(db, self(bertaUser), file))).toBe('404 attachment_not_found')
    // A child template is no choice for an employee.
    expect(failure(() => createMyAccident(db, annaUser, { templateId: childTemplate, ...header }, NOW))).toBe('404 form_template_not_found')
  })

  it('goes along when the employee moves to another facility', () => {
    const id = createMyAccident(db, annaUser, { templateId: u1000Template, ...header }, NOW)
    const other = addFacility(db, 'Zweite')
    moveEmployeeAccidents(db, anna, other)
    db.update(employees).set({ facilityId: other }).where(eq(employees.id, anna)).run()
    expect(failure(() => getEmployeeAccident(db, manager(leitungUser), id))).toBe('404 form_not_found')
    expect(getEmployeeAccident(db, manager(addUser(db, 'leitung2', 'admin', null, other)), id)).toMatchObject({ templateId: null })
  })
})

describe('overview and reminder', () => {
  it('lists the facility\'s reports of the year, children and employees, for Leitung/Träger only', () => {
    createChildAccident(db, leitung, kid, { templateId: childTemplate, ...header, date: '2025-12-31' }, NOW)
    const childReport = createChildAccident(db, leitung, kid, { templateId: childTemplate, ...header, doctor: true }, NOW)
    const staffReport = createMyAccident(db, annaUser, { templateId: u1000Template, ...header, date: '2026-01-02', unfit: true, reportedOn: '2026-01-03' }, NOW)
    const list = listAccidentOverview(db, leitungUser, 1, 2026, NOW)
    expect(list.map(item => [item.id, item.subject, item.personName, item.doctor, item.unfit, item.reportedOn])).toEqual([
      [childReport, 'child', 'Lena Kurz', true, false, null],
      [staffReport, 'employee', 'Anna Muster', false, true, '2026-01-03'],
    ])
    expect(listAccidentOverview(db, leitungUser, 1, 2025, NOW)).toHaveLength(1)
    expect(failure(() => listAccidentOverview(db, annaUser, 1, 2026, NOW))).toBe('403 forbidden')
    expect(listAccidentOverview(db, addUser(db, 'l2', 'admin', null, addFacility(db, 'Zweite')), 2, 2026, NOW)).toEqual([])
  })

  it('reminds Leitung/Träger of a report with Arztbesuch or arbeitsunfähig until „gemeldet am“ is set; overdue after 3 days', () => {
    const quiet = createChildAccident(db, leitung, kid, { templateId: childTemplate, ...header }, NOW)
    const doctor = createChildAccident(db, leitung, kid, { templateId: childTemplate, ...header, date: '2026-11-14', doctor: true }, NOW)
    createMyAccident(db, annaUser, { templateId: u1000Template, ...header, unfit: true }, NOW)
    expect(quiet).toBeGreaterThan(0)
    const office = { permissions: leitung.permissions, onTablet: false, facilityId: 1 }
    expect(accidentReminders(db, office, '2026-11-18').map(item => [item.name, item.date, item.state, item.childId]).sort()).toEqual([
      ['Anna Muster', '2026-11-17', 'upcoming', null],
      ['Lena Kurz', '2026-11-14', 'overdue', kid],
    ])
    expect(accidentReminders(db, office, '2026-11-17').find(item => item.childId === kid)!.state).toBe('today')
    // Not for staff, not at the tablet; in the box of the Leitung.
    expect(accidentReminders(db, { ...office, permissions: annaTablet.permissions }, '2026-11-18')).toEqual([])
    expect(accidentReminders(db, { ...office, onTablet: true }, '2026-11-18')).toEqual([])
    expect(listReminders(db, leitung, '2026-11-18').filter(item => item.kind === 'accident')).toHaveLength(2)

    const loaded = getChildAccident(db, leitung, doctor, NOW)
    saveChildAccident(db, leitung, doctor, { ...header, date: '2026-11-14', doctor: true, reportedOn: '2026-11-18', answers: {}, expectedUpdatedAt: loaded.updatedAt }, LATER)
    expect(accidentReminders(db, office, '2026-11-18').map(item => item.name)).toEqual(['Anna Muster'])
  })
})

describe('U 1000 fields', () => {
  it('groups unnumbered items with the field before them and keeps strays apart', () => {
    const content = {
      sections: [{
        id: 's', title: 'A', hint: '', items: [
          { id: 'x', kind: 'text', question: 'Vorab' }, { id: 'a', kind: 'text', question: '18 Schilderung' },
          { id: 'b', kind: 'choices', question: 'Die Angaben beruhen auf der Schilderung', options: [{ id: 'o', label: 'x' }] },
          { id: 'c', kind: 'text', question: '18 nochmal' }, { id: 'd', kind: 'text', question: '19 Körperteile' },
        ],
      }],
    } as FormContent
    const { fields, other } = u1000Fields(content)
    expect(fields.get(18)!.map(item => item.id)).toEqual(['a', 'b'])
    expect(fields.get(19)!.map(item => item.id)).toEqual(['d'])
    expect(other.map(item => item.id)).toEqual(['x', 'c'])
  })
})
