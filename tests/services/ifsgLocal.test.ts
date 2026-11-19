import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childDocuments, childIfsgCases, documentTypes } from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import { documentDownload } from '../../server/lib/documentHttp'
import { arrive, getAttendanceDay } from '../../server/services/childAttendance'
import {
  acknowledgeIfsgCluster, getIfsgSettings, ifsgClusterReminders, ifsgDeclaration, ifsgReminders, ifsgRules, readmitIfsgCase,
  setIfsgSettings,
} from '../../server/services/ifsg'
import { createIfsgCase } from '../../server/services/ifsgCases'
import {
  addLocalDisease, applyIfsgPreset, deleteIfsgDocument, deleteLocalRule, listIfsgDocuments, localRulesOverview, readIfsgDocument,
  saveLocalRule, uploadIfsgDocument,
} from '../../server/services/ifsgLocal'
import type { IfsgCaseInput } from '../../shared/types/api'
import { addChild, addGroup, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

const berlin = (date: string, time = '10:00') => new Date(`${date}T${time}:00+01:00`)
const TODAY = '2026-11-18'
const NOW = berlin(TODAY)
const PDF = Buffer.from('%PDF-1.4\n%test\n')
const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

describe('local rules of the health office (§ 34 IfSG)', () => {
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

  const create = (overrides: Partial<IfsgCaseInput> = {}, now = NOW) => createIfsgCase(db, leitung, {
    childId: lena, date: TODAY, disease: 'mumps', kind: 'sick', onsetDate: '2026-11-17', ruleVariant: null, ruleDate: null, ...overrides,
  }, now)
  const rowOf = (childId: number) => getAttendanceDay(db, leitung, TODAY, NOW).children.find(child => child.childId === childId)!
  const readmit = (id: number, overrides: Partial<{ note: string; confirmEarly: boolean }> = {}, file: { data: Buffer } | null = null) =>
    readmitIfsgCase(db, leitung, id, { readmittedOn: TODAY, note: '', confirmEarly: true, ...overrides }, file, NOW)

  it('stores the health office with the setting', () => {
    setIfsgSettings(db, 1, { requireAttest: false, healthOfficeName: ' Rhein-Neckar-Kreis ', healthOfficePhone: '06221 522-1817' })
    expect(getIfsgSettings(db, 1)).toEqual({ requireAttest: false, healthOfficeName: 'Rhein-Neckar-Kreis', healthOfficePhone: '06221 522-1817' })
    expect(ifsgRules(db, leitung).healthOffice).toEqual({ name: 'Rhein-Neckar-Kreis', phone: '06221 522-1817' })
  })

  it('lets a local rule decide the earliest day, the proof and the source in the attendance', () => {
    saveLocalRule(db, 1, 'mumps', { rules: [{ anchor: 'gland_swelling', days: 5, label: '' }], proof: 'parent_declaration' }, NOW)
    create({ ruleVariant: 'local1', ruleDate: '2026-11-16' })
    expect(rowOf(lena).ifsg).toMatchObject({ earliest: '2026-11-21', proof: 'parent_declaration', source: 'local', binding: true })
    // The RKI's own rule key is gone for a new case.
    expect(errorCode(() => create({ childId: max, ruleVariant: 'onset' }))).toBe('ifsg_rule_invalid')
    expect(localRulesOverview(db, 1).rows.find(row => row.key === 'mumps')).toMatchObject({
      difference: { proof: { rki: 'medical_certificate', local: 'parent_declaration' } }, used: true,
    })
  })

  it('checks a local rule: known disease, valid rules, a name for a local disease', () => {
    expect(errorCode(() => saveLocalRule(db, 1, 'grippe', { text: 'x' }, NOW))).toBe('ifsg_disease_unknown')
    expect(errorCode(() => saveLocalRule(db, 1, 'mumps', { rules: [{ anchor: 'onset', days: 400, label: '' }] }, NOW))).toBe('ifsg_local_invalid')
    expect(errorCode(() => addLocalDisease(db, 1, { name: '  ' }, NOW))).toBe('ifsg_local_name_required')
    expect(errorCode(() => addLocalDisease(db, 1, { name: 'Masern' }, NOW))).toBe('ifsg_local_name_taken')
    const key = addLocalDisease(db, 1, { name: 'Hand-Fuß-Mund-Krankheit', notifiable: false, text: 'Bis die Bläschen eingetrocknet sind.' }, NOW)
    expect(key).toBe('local_hand_fuss_mund_krankheit')
    expect(errorCode(() => saveLocalRule(db, 1, key, { name: '' }, NOW))).toBe('ifsg_local_name_required')
    // Back to the RKI, or gone; a local disease in use stays.
    saveLocalRule(db, 1, 'mumps', { proof: 'parent_declaration' }, NOW)
    deleteLocalRule(db, 1, 'mumps')
    expect(localRulesOverview(db, 1).rows.find(row => row.key === 'mumps')?.local).toBeNull()
    create({ disease: key })
    expect(errorCode(() => deleteLocalRule(db, 1, key))).toBe('ifsg_local_in_use')
    expect(errorCode(() => deleteLocalRule(db, 1, 'masern'))).toBe('ifsg_local_not_found')
  })

  describe('presets', () => {
    it('applies the Rhein-Neckar-Kreis document with all rows and fills the health office', () => {
      expect(applyIfsgPreset(db, 1, 'rnk_2024', false, NOW)).toBe(36)
      const overview = localRulesOverview(db, 1)
      expect(overview.rows).toHaveLength(36)
      expect(overview.healthOffice).toEqual({ name: 'Rhein-Neckar-Kreis/Heidelberg', phone: '06221 522-1817' })
      expect(overview.rows.find(row => row.key === 'covid19')?.merged).toMatchObject({ name: 'COVID-19', binding: false })
      expect(overview.rows.find(row => row.key === 'kopflaus')?.difference?.proof).toEqual({ rki: 'medical_certificate', local: 'parent_declaration' })
    })

    it('asks before overwriting local rows and keeps other local diseases', () => {
      saveLocalRule(db, 1, 'masern', { text: 'Eigener Text.' }, NOW)
      addLocalDisease(db, 1, { name: 'Ringelröteln (eigene)', notifiable: false }, NOW)
      expect(errorCode(() => applyIfsgPreset(db, 1, 'rki', false, NOW))).toBe('ifsg_local_exists')
      expect(localRulesOverview(db, 1).rows.find(row => row.key === 'masern')?.local?.text).toBe('Eigener Text.')
      expect(applyIfsgPreset(db, 1, 'rki', true, NOW)).toBe(24)
      const rows = localRulesOverview(db, 1).rows
      expect(rows.find(row => row.key === 'masern')?.difference).toBeNull()
      expect(rows.some(row => row.merged.name === 'Ringelröteln (eigene)')).toBe(true)
    })
  })

  describe('proof flows', () => {
    it('prints and stores the parents declaration', () => {
      applyIfsgPreset(db, 1, 'rnk_2024', false, NOW)
      const id = create({ disease: 'windpocken', ruleVariant: 'local1' })
      expect(rowOf(lena).ifsg?.proof).toBe('parent_declaration')
      expect(ifsgDeclaration(db, leitung, id)).toEqual({ caseId: id, facilityName: expect.any(String), childName: 'Lena Meier', diseaseName: 'Windpocken (Varizellen)' })
      readmit(id, {}, { data: PDF })
      const stored = db.select().from(childDocuments).get()!
      expect(db.select().from(documentTypes).where(eq(documentTypes.id, stored.documentTypeId)).get()?.name).toBe('Elternerklärung')
    })

    it('needs a note who was consulted when the health office decides', () => {
      const id = create({ disease: 'shigellose' })
      expect(rowOf(lena).ifsg).toMatchObject({ proof: 'health_office', healthOffice: { name: '', phone: '' } })
      expect(errorCode(() => readmit(id, { note: ' ' }))).toBe('ifsg_note_required')
      readmit(id, { note: 'Frau Muster, 18.11. 10 Uhr' })
      expect(db.select().from(childIfsgCases).get()?.readmissionNote).toBe('Frau Muster, 18.11. 10 Uhr')
    })

    it('lets only the own group and the managers print the declaration', () => {
      const id = create()
      const other = { ...leitung, permissions: new Set(['children.view', 'children.attendance'] as const), groups: { own: mice, readable: [] } }
      expect(errorCode(() => ifsgDeclaration(db, other as unknown as ChildActor, id))).toBe('group_read_only')
    })
  })

  it('treats a non-notifiable local disease as a recommendation: no reminder, no block, „Kommt“ ends it', () => {
    const key = addLocalDisease(db, 1, { name: 'Hand-Fuß-Mund-Krankheit', notifiable: false }, NOW)
    const id = create({ disease: key })
    expect(rowOf(lena).ifsg).toMatchObject({ caseId: id, binding: false })
    expect(ifsgReminders(db, leitung, TODAY)).toEqual([])
    arrive(db, leitung, { childId: lena, date: TODAY, time: hm('08:00'), plannedPickup: hm('15:00') }, NOW)
    expect(db.select().from(childIfsgCases).get()).toMatchObject({ readmittedOn: TODAY, readmittedByName: 'leitung' })
    expect(rowOf(lena).ifsg).toBeNull()
    // A notifiable local disease blocks and reminds like an RKI one.
    const covid = addLocalDisease(db, 1, { name: 'COVID-19 (meldepflichtig)', notifiable: true }, NOW)
    create({ childId: max, disease: covid })
    expect(errorCode(() => arrive(db, leitung, { childId: max, date: TODAY, time: hm('08:00'), plannedPickup: hm('15:00') }, NOW)))
      .toBe('ifsg_readmission_required')
    expect(ifsgReminders(db, leitung, TODAY).map(item => item.childId)).toEqual([max])
  })

  it('reminds of the health office with its name and phone', () => {
    setIfsgSettings(db, 1, { requireAttest: false, healthOfficeName: 'RNK', healthOfficePhone: '06221 1' })
    create()
    expect(ifsgReminders(db, leitung, TODAY)[0]?.ifsg?.healthOffice).toEqual({ name: 'RNK', phone: '06221 1' })
  })

  describe('clusters', () => {
    it('reminds of two cases of the same disease within 14 days, not 15, until acknowledged', () => {
      create({ disease: 'kopflaus', date: '2026-11-04', onsetDate: '2026-11-04' }, berlin('2026-11-04'))
      createIfsgCase(db, leitung, {
        childId: max, date: '2026-11-04', disease: 'kopflaus', kind: 'sick', onsetDate: '2026-11-04', ruleVariant: null, ruleDate: null,
      }, berlin('2026-11-04'))
      expect(ifsgClusterReminders(db, leitung, TODAY)).toEqual([expect.objectContaining({
        kind: 'ifsgCluster', state: 'overdue', name: 'Kopflausbefall', count: 2,
        ifsgCluster: { disease: 'kopflaus', diseaseName: 'Kopflausbefall', count: 2, from: '2026-11-04', to: '2026-11-04' },
      })])
      expect(errorCode(() => acknowledgeIfsgCluster(db, leitung, 'kopflaus', '2026-11-19', NOW))).toBe('invalid_date')
      acknowledgeIfsgCluster(db, leitung, 'kopflaus', TODAY, NOW)
      expect(ifsgClusterReminders(db, leitung, TODAY)).toEqual([])
      expect(errorCode(() => acknowledgeIfsgCluster(db, leitung, 'kopflaus', TODAY, NOW))).toBe('ifsg_cluster_not_found')
      expect(ifsgClusterReminders(db, { ...leitung, onTablet: true }, TODAY)).toEqual([])
    })

    it('does not count cases 15 days apart, and counts local non-notifiable diseases too', () => {
      create({ disease: 'scharlach', onsetDate: '2026-11-01', date: '2026-11-01' }, berlin('2026-11-01'))
      createIfsgCase(db, leitung, {
        childId: max, date: '2026-11-16', disease: 'scharlach', kind: 'sick', onsetDate: '2026-11-16', ruleVariant: null, ruleDate: null,
      }, berlin('2026-11-16'))
      expect(ifsgClusterReminders(db, leitung, TODAY)).toEqual([])
      const key = addLocalDisease(db, 1, { name: 'Ringelröteln', notifiable: false }, NOW)
      create({ disease: key })
      create({ childId: max, disease: key })
      expect(ifsgClusterReminders(db, leitung, TODAY).map(item => [item.ifsgCluster?.disease, item.count])).toEqual([[key, 2]])
    })
  })

  describe('the health office documents', () => {
    it('are uploaded, listed, read and deleted; at the tablet never as a download', () => {
      const id = uploadIfsgDocument(db, { id: leitung.id, facilityId: 1 }, ' Wiederzulassung RNK ', { data: PDF }, NOW)
      expect(listIfsgDocuments(db, 1)).toEqual([{ id, title: 'Wiederzulassung RNK', mimeType: 'application/pdf', size: PDF.length, uploadedAt: NOW.toISOString() }])
      expect(readIfsgDocument(db, 1, id)).toMatchObject({ mimeType: 'application/pdf', fileName: 'Wiederzulassung-RNK.pdf' })
      expect(errorCode(() => readIfsgDocument(db, 2, id))).toBe('document_not_found')
      expect(errorCode(() => uploadIfsgDocument(db, { id: leitung.id, facilityId: 1 }, '', { data: Buffer.from('nope') }, NOW))).toBe('document_type_invalid')
      expect(documentDownload({ onTablet: true }, true, 'empty')).toBe(false)
      expect(errorCode(() => documentDownload({ onTablet: true }, false, 'document'))).toBe('forbidden')
      deleteIfsgDocument(db, 1, id)
      expect(listIfsgDocuments(db, 1)).toEqual([])
    })
  })
})
