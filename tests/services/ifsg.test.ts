import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import type { Db } from '../../server/db/client'
import { childAttendanceDays, childDocuments, childIfsgCases, documentTypes } from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import { arrive, getAttendanceDay } from '../../server/services/childAttendance'
import { deleteChild } from '../../server/services/children'
import {
  deleteIfsgCase, getIfsgSettings, ifsgNotice, ifsgReminders, ifsgRules, listIfsgCases, readmitIfsgCase, setIfsgSettings,
  updateIfsgCase,
} from '../../server/services/ifsg'
import { createIfsgCase } from '../../server/services/ifsgCases'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { listReminders } from '../../server/services/reminders'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { IfsgCaseInput, SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addGroup, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

/** A moment in Berlin (winter time in November). */
const berlin = (date: string, time = '10:00') => new Date(`${date}T${time}:00+01:00`)
const TODAY = '2026-11-18' // a Wednesday
const NOW = berlin(TODAY)
const PDF = Buffer.from('%PDF-1.4\n%test\n')
const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

describe('§ 34 IfSG cases', () => {
  let db: Db
  let leitung: ChildActor
  let bears: number
  let mice: number
  let lena: number
  let max: number

  beforeEach(() => {
    db = createTestDb()
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    lena = addChild(db, 1, { lastName: 'Meier', firstName: 'Lena', groupId: bears })
    max = addChild(db, 1, { lastName: 'Klein', firstName: 'Max', groupId: mice })
  })

  const input = (overrides: Partial<IfsgCaseInput> = {}): IfsgCaseInput => ({
    childId: lena, date: TODAY, disease: 'windpocken', kind: 'sick', onsetDate: '2026-11-17', ruleVariant: 'onset', ruleDate: null,
    ...overrides,
  })
  const create = (overrides: Partial<IfsgCaseInput> = {}, viewer: ChildActor = leitung) => createIfsgCase(db, viewer, input(overrides), NOW)
  const readmit = (id: number, overrides: Partial<{ readmittedOn: string; note: string; confirmEarly: boolean }> = {},
    file: { data: Buffer } | null = null, viewer: ChildActor = leitung, now = NOW) =>
    readmitIfsgCase(db, viewer, id, { readmittedOn: TODAY, note: '', confirmEarly: false, ...overrides }, file, now)
  const absenceOf = (childId: number, date = TODAY) => db.select().from(childAttendanceDays)
    .where(eq(childAttendanceDays.childId, childId)).all().find(day => day.date === date)?.absence ?? null
  const rowOf = (childId: number, viewer: ChildActor = leitung, date = TODAY, now = NOW) =>
    getAttendanceDay(db, viewer, date, now).children.find(child => child.childId === childId)!
  const arriveAt = (childId: number, date = TODAY, now = NOW) =>
    arrive(db, leitung, { childId, date, time: hm('08:00'), plannedPickup: hm('15:00') }, now)

  describe('creating a case', () => {
    it('stores the case and books the day as sick, like the absence dialog', () => {
      const id = create()
      expect(db.select().from(childIfsgCases).where(eq(childIfsgCases.id, id)).get()).toMatchObject({
        childId: lena, facilityId: 1, disease: 'windpocken', kind: 'sick', reportedOn: TODAY, onsetDate: '2026-11-17',
        ruleVariant: 'onset', ruleDate: null, createdByName: 'leitung', readmittedOn: null, ended: false,
      })
      expect(absenceOf(lena)).toBe('sick')
    })

    it('books a household contact or a carrier as excused, not as sick', () => {
      create({ disease: 'masern', kind: 'household', ruleVariant: 'last_contact', ruleDate: '2026-11-16' })
      expect(absenceOf(lena)).toBe('excused')
      create({ childId: max, disease: 'typhus', kind: 'carrier', ruleVariant: null })
      expect(absenceOf(max)).toBe('excused')
    })

    it('checks the disease, its kinds, the date rule and the dates against the rules', () => {
      expect(errorCode(() => create({ disease: 'grippe' }))).toBe('ifsg_disease_unknown')
      // Windpocken has no Ausscheider (table 1).
      expect(errorCode(() => create({ kind: 'carrier' }))).toBe('ifsg_kind_invalid')
      expect(errorCode(() => create({ ruleVariant: 'antibiotic' }))).toBe('ifsg_rule_invalid')
      expect(errorCode(() => create({ onsetDate: '2026-11-19' }))).toBe('invalid_date')
      expect(errorCode(() => create({ date: '2026-11-19', onsetDate: '2026-11-19' }))).toBe('attendance_future')
      expect(db.select().from(childIfsgCases).all()).toEqual([])
      expect(absenceOf(lena)).toBeNull()
    })

    it('refuses a second open case of the same disease, not one of another disease', () => {
      create()
      expect(errorCode(() => create())).toBe('ifsg_case_open')
      expect(() => create({ disease: 'kopflaus', ruleVariant: null })).not.toThrow()
    })
  })

  describe('the block at „Kommt“', () => {
    it('refuses stamping in from the case day until the readmission, not on the days before', () => {
      const id = create({ disease: 'kopflaus', ruleVariant: null })
      expect(errorCode(() => arriveAt(lena))).toBe('ifsg_readmission_required')
      // A correction of yesterday is not blocked.
      expect(() => arriveAt(lena, '2026-11-17')).not.toThrow()
      readmit(id)
      expect(() => arriveAt(lena)).not.toThrow()
      expect(rowOf(lena).ifsg).toBeNull()
    })

    it('shows the open case in the day list with the earliest day', () => {
      const id = create()
      expect(rowOf(lena).ifsg).toEqual({
        caseId: id, disease: 'windpocken', diseaseName: 'Windpocken (Varizellen)', kind: 'sick',
        text: expect.stringContaining('verkrustet'), condition: 'und alle Bläschen verkrustet', earliest: '2026-11-24',
        proof: 'medical_certificate', canReadmit: true, requireAttest: false, binding: true, source: 'rki',
        healthOffice: { name: '', phone: '' }, reportedOn: TODAY, onsetDate: '2026-11-17', ruleVariant: 'onset', ruleDate: null,
        rule: { anchor: 'onset', days: 7, label: '', condition: 'und alle Bläschen verkrustet' }, readmittedOn: null,
      })
      expect(rowOf(max).ifsg).toBeNull()
      // The day before the case shows nothing.
      expect(rowOf(lena, leitung, '2026-11-17').ifsg).toBeNull()
    })

    it('closes the case when the Leitung ends it without a readmission', () => {
      const id = create()
      updateIfsgCase(db, leitung, id, { ended: true })
      expect(() => arriveAt(lena)).not.toThrow()
      expect(errorCode(() => readmit(id))).toBe('ifsg_case_closed')
    })
  })

  describe('the readmission', () => {
    it('asks for a confirmation before the earliest day and tells the day', () => {
      const id = create() // Windpocken from 17.11.: earliest 24.11.
      let error: unknown
      try {
        readmit(id)
      }
      catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(ServiceError)
      expect(error).toMatchObject({ statusCode: 409, code: 'ifsg_before_earliest', details: { earliest: '2026-11-24' } })
      readmit(id, { confirmEarly: true, note: 'Kinderarzt Dr. Weiß' })
      expect(db.select().from(childIfsgCases).get()).toMatchObject({
        readmittedOn: TODAY, readmissionNote: 'Kinderarzt Dr. Weiß', readmittedByName: 'leitung', readmissionAttachmentId: null,
      })
    })

    it('needs no confirmation on or after the earliest day, nor without a date rule', () => {
      const id = create({ onsetDate: '2026-11-11' }) // earliest 18.11. = today
      expect(() => readmit(id)).not.toThrow()
      const lice = create({ childId: max, disease: 'kopflaus', ruleVariant: null })
      expect(() => readmit(lice)).not.toThrow()
    })

    it('refuses a day ahead or before the onset', () => {
      const id = create({ disease: 'kopflaus', ruleVariant: null })
      expect(errorCode(() => readmit(id, { readmittedOn: '2026-11-19' }))).toBe('invalid_date')
      expect(errorCode(() => readmit(id, { readmittedOn: '2026-11-16' }))).toBe('invalid_date')
    })

    it('requires the attest when the facility asks for one, and stores it as a confidential document', () => {
      expect(getIfsgSettings(db, 1)).toEqual({ requireAttest: false, healthOfficeName: '', healthOfficePhone: '' })
      setIfsgSettings(db, 1, { requireAttest: true, healthOfficeName: '', healthOfficePhone: '' })
      expect(ifsgRules(db, leitung).requireAttest).toBe(true)
      const id = create({ disease: 'kopflaus', ruleVariant: null })
      expect(rowOf(lena).ifsg?.requireAttest).toBe(true)
      expect(errorCode(() => readmit(id))).toBe('ifsg_attest_required')
      expect(errorCode(() => readmit(id, {}, { data: Buffer.from('not a pdf') }))).toBe('document_type_invalid')
      // The attest may have up to 30 MB, not one byte more.
      const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES + 1 - PDF.length)])
      expect(errorCode(() => readmit(id, {}, { data: big }))).toBe('document_too_large')
      readmit(id, {}, { data: big.subarray(0, MAX_DOCUMENT_BYTES) })
      const stored = db.select().from(childDocuments).get()!
      expect(stored).toMatchObject({ childId: lena, title: 'Wiederzulassung (§ 34 IfSG)', confidential: true, documentDate: TODAY, mimeType: 'application/pdf' })
      expect(db.select().from(documentTypes).where(eq(documentTypes.id, stored.documentTypeId)).get()?.name).toBe('Ärztliches Attest')
      expect(db.select().from(childIfsgCases).get()?.readmissionAttachmentId).toBe(stored.id)
      // A second attest reuses the type.
      const second = create({ childId: max, disease: 'kopflaus', ruleVariant: null })
      readmit(second, {}, { data: PDF })
      expect(db.select().from(documentTypes).all().filter(type => type.name === 'Ärztliches Attest')).toHaveLength(1)
    })

    it('does not ask for an attest where the health office decides', () => {
      setIfsgSettings(db, 1, { requireAttest: true, healthOfficeName: '', healthOfficePhone: '' })
      const id = create({ disease: 'shigellose', ruleVariant: null })
      expect(rowOf(lena).ifsg?.proof).toBe('health_office')
      expect(() => readmit(id, { note: 'Gesundheitsamt, Frau Muster' })).not.toThrow()
    })
  })

  describe('the reminder to notify the health office', () => {
    const reminders = (viewer: ChildActor = leitung, today = TODAY) => ifsgReminders(db, viewer, today)

    it('reminds the Leitung until the notification day is set', () => {
      const id = create()
      expect(reminders()).toEqual([expect.objectContaining({
        kind: 'ifsg', date: TODAY, state: 'today', name: 'Lena Meier', childId: lena,
        ifsg: { caseId: id, diseaseName: 'Windpocken (Varizellen)', groupName: 'Bären', healthOffice: { name: '', phone: '' } },
      })])
      expect(reminders(leitung, '2026-11-19')[0]?.state).toBe('overdue')
      expect(listReminders(db, leitung, TODAY).filter(item => item.kind === 'ifsg')).toHaveLength(1)
      updateIfsgCase(db, leitung, id, { healthOfficeNotifiedOn: TODAY })
      expect(reminders()).toEqual([])
      expect(listIfsgCases(db, leitung, 2026)[0]).toMatchObject({ healthOfficeNotifiedOn: TODAY, notifyDue: false })
    })

    it('ends with the physician\'s report as well, and keeps reminding after a readmission', () => {
      const id = create({ disease: 'kopflaus', ruleVariant: null })
      readmit(id)
      expect(reminders()).toHaveLength(1)
      updateIfsgCase(db, leitung, id, { physicianReported: true })
      expect(reminders()).toEqual([])
    })

    it('is for Leitung and Träger at the office only', () => {
      create()
      const anna = addEmployee(db, 'Anna', { groupId: bears })
      const staff = { ...asChildViewer(addUser(db, 'anna', 'observer', anna)), groups: { own: bears, readable: [] } }
      expect(reminders(staff)).toEqual([])
      expect(reminders({ ...leitung, onTablet: true })).toEqual([])
    })
  })

  describe('who sees the disease', () => {
    let tablet: SessionUser
    let token: string
    const atTablet = () => resolveChildViewer(db, tablet, token, NOW) as ChildActor

    beforeEach(() => {
      setTabletSettings(db, 1, { lockMinutes: 10, showWaitlist: true, showFutureContracts: true })
      tablet = addUser(db, 'tablet', 'terminal')
      const anna = addEmployee(db, 'Anna', { groupId: bears })
      setPin(db, 1, anna, '123456')
      // The bears may read the mice's records.
      setReadAccess(db, 1, bears, [mice])
      token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, anna, '123456', NOW).token
    })

    it('shows it to the own group at the tablet, another group only the block', () => {
      const own = create()
      const other = create({ childId: max, disease: 'scharlach', ruleVariant: 'antibiotic', ruleDate: '2026-11-17' })
      expect(rowOf(lena, atTablet())?.ifsg).toMatchObject({ caseId: own, disease: 'windpocken', canReadmit: true })
      expect(rowOf(max, atTablet())?.ifsg).toEqual({
        caseId: other, disease: null, diseaseName: null, kind: null, text: null, condition: null, earliest: null, proof: null,
        canReadmit: false, requireAttest: false, binding: true, source: null, healthOffice: { name: '', phone: '' }, onsetDate: null,
        ruleVariant: null, ruleDate: null, readmittedOn: null, reportedOn: null, rule: null,
      })
      // The Leitung sees both.
      expect(rowOf(max)?.ifsg?.diseaseName).toBe('Scharlach / Streptococcus-pyogenes-Infektion')
    })

    it('lets only the own group and the managers enter, change and readmit', () => {
      expect(errorCode(() => create({ childId: max }, atTablet()))).toBe('group_read_only')
      const own = create({ disease: 'kopflaus', ruleVariant: null }, atTablet())
      expect(db.select().from(childIfsgCases).get()?.createdByName).toBe('Anna')
      const other = create({ childId: max, disease: 'kopflaus', ruleVariant: null })
      expect(errorCode(() => readmit(other, {}, null, atTablet()))).toBe('group_read_only')
      expect(errorCode(() => updateIfsgCase(db, atTablet(), other, { onsetDate: '2026-11-16' }))).toBe('group_read_only')
      // The own group corrects the dates, but the health office fields are the Leitung's.
      expect(() => updateIfsgCase(db, atTablet(), own, { onsetDate: '2026-11-16' })).not.toThrow()
      expect(errorCode(() => updateIfsgCase(db, atTablet(), own, { healthOfficeNotifiedOn: TODAY }))).toBe('forbidden')
      expect(errorCode(() => updateIfsgCase(db, atTablet(), own, { physicianReported: true }))).toBe('forbidden')
      readmit(own, {}, { data: PDF }, atTablet())
      // At the tablet the person without own account stores the attest without an uploader.
      expect(db.select().from(childDocuments).get()?.confidential).toBe(true)
    })

    it('blocks stamping in for everybody: the own group and another group at the tablet', () => {
      create()
      create({ childId: max, disease: 'kopflaus', ruleVariant: null })
      const stampIn = (childId: number) => arrive(db, atTablet(), { childId, date: TODAY, time: hm('08:00'), plannedPickup: hm('15:00') }, NOW)
      expect(errorCode(() => stampIn(lena))).toBe('ifsg_readmission_required')
      expect(errorCode(() => stampIn(max))).toBe('ifsg_readmission_required')
    })

    it('hides the disease from a reader without the attendance right', () => {
      create()
      const reader = { ...leitung, permissions: new Set(['children.view'] as const) }
      expect(rowOf(lena, reader as unknown as ChildActor).ifsg).toMatchObject({ disease: null, canReadmit: false })
    })
  })

  describe('overview and notice', () => {
    it('lists the cases entered in the year, the latest first', () => {
      const old = createIfsgCase(db, leitung, input({ date: '2025-12-30', onsetDate: '2025-12-29', disease: 'mumps', ruleVariant: null }), berlin('2025-12-30'))
      const first = create({ disease: 'kopflaus', ruleVariant: null })
      const second = create({ childId: max, kind: 'household', ruleVariant: 'last_contact', ruleDate: '2026-11-16' })
      expect(listIfsgCases(db, leitung, 2026).map(item => item.id)).toEqual([second, first])
      expect(listIfsgCases(db, leitung, 2025).map(item => item.id)).toEqual([old])
      expect(listIfsgCases(db, leitung, 2026)[0]).toMatchObject({
        childName: 'Max Klein', groupName: 'Mäuse', diseaseName: 'Windpocken (Varizellen)', kind: 'household',
        earliest: '2026-12-02', open: true, notifyDue: true, healthOfficeNotifiedOn: null, physicianReported: false,
      })
    })

    it('prints the notice without any name of the child', () => {
      const id = create()
      const notice = ifsgNotice(db, leitung, id)
      expect(notice).toEqual({
        caseId: id, facilityName: expect.any(String), groupName: 'Bären', diseaseName: 'Windpocken (Varizellen)',
        hint: expect.stringContaining('Bläschen'), reportedOn: TODAY,
      })
      expect(JSON.stringify(notice)).not.toMatch(/Lena|Meier/)
    })

    it('answers 404 for a case of another facility', () => {
      const id = create()
      expect(errorCode(() => ifsgNotice(db, { ...leitung, facilityId: 2 }, id))).toBe('ifsg_case_not_found')
      expect(errorCode(() => deleteIfsgCase(db, { ...leitung, facilityId: 2 }, id))).toBe('ifsg_case_not_found')
    })
  })

  it('deletes the cases with the child record, and a case on its own', () => {
    const id = create()
    create({ childId: max, disease: 'kopflaus', ruleVariant: null })
    deleteIfsgCase(db, leitung, id)
    expect(db.select().from(childIfsgCases).all().map(row => row.childId)).toEqual([max])
    deleteChild(db, 1, max)
    expect(db.select().from(childIfsgCases).all()).toEqual([])
  })
})
