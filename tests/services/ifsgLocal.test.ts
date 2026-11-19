import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childDocuments, childIfsgCases, documentTypes } from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import { documentDownload } from '../../server/lib/documentHttp'
import { arrive, getAttendanceDay } from '../../server/services/childAttendance'
import {
  acknowledgeIfsgCluster, getIfsgSettings, ifsgClusterReminders, ifsgDeclaration, ifsgReminders, ifsgRules, listIfsgCases, readmitIfsgCase,
  updateIfsgCase,
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
    create({ ruleVariant: 'gland_swelling_5', ruleDate: '2026-11-16' })
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
      const id = create({ disease: 'windpocken', ruleVariant: 'onset' })
      expect(rowOf(lena).ifsg?.proof).toBe('parent_declaration')
      expect(ifsgDeclaration(db, leitung, id)).toEqual({ caseId: id, facilityName: expect.any(String), childName: 'Lena Meier', diseaseName: 'Windpocken (Varizellen)', form: 'declaration' })
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

  describe('fix round 1', () => {
    const readmitOn = (id: number, readmittedOn: string, confirmEarly = false) =>
      readmitIfsgCase(db, leitung, id, { readmittedOn, note: 'Rücksprache', confirmEarly }, null, NOW)

    it('keeps the earliest day of an open case when a preset changes the rules, and its notification still works (I-1)', () => {
      // Masern from the rash on 16.11.: earliest 21.11. (RKI rash + 5).
      const id = create({ disease: 'masern', ruleVariant: 'rash', ruleDate: '2026-11-16' })
      applyIfsgPreset(db, 1, 'rnk_2024', false, NOW)
      applyIfsgPreset(db, 1, 'rki', true, NOW)
      expect(rowOf(lena).ifsg).toMatchObject({ earliest: '2026-11-21', condition: 'nach ärztlicher Beurteilung' })
      expect(errorCode(() => readmitOn(id, TODAY))).toBe('ifsg_before_earliest')
      // Benachrichtigt, Arztmeldung and Fall abschließen do not re-check the rule.
      updateIfsgCase(db, leitung, id, { healthOfficeNotifiedOn: TODAY })
      updateIfsgCase(db, leitung, id, { physicianReported: true })
      expect(ifsgReminders(db, leitung, TODAY)).toEqual([])
      // An own rule edited in place (another day count) does not move the stored rule either.
      saveLocalRule(db, 1, 'masern', { rules: [{ anchor: 'rash', days: 1, label: '' }] }, NOW)
      expect(rowOf(lena).ifsg?.earliest).toBe('2026-11-21')
      updateIfsgCase(db, leitung, id, { ended: true })
      expect(rowOf(lena).ifsg).toBeNull()
    })

    it("lets the date rule and its date be added later, checked against today's rules (M-4)", () => {
      const id = create({ disease: 'keuchhusten' })
      expect(rowOf(lena).ifsg).toMatchObject({ earliest: null, ruleVariant: null, onsetDate: '2026-11-17' })
      updateIfsgCase(db, leitung, id, { ruleVariant: 'antibiotic', ruleDate: '2026-11-17' })
      expect(rowOf(lena).ifsg).toMatchObject({ earliest: '2026-11-22', ruleVariant: 'antibiotic', ruleDate: '2026-11-17' })
      expect(errorCode(() => updateIfsgCase(db, leitung, id, { ruleVariant: 'rash' }))).toBe('ifsg_rule_invalid')
      expect(errorCode(() => updateIfsgCase(db, leitung, id, { onsetDate: '2026-11-19' }))).toBe('invalid_date')
    })

    it('keeps the RKI day for Hepatitis A without jaundice under the Rhein-Neckar-Kreis preset (I-2)', () => {
      applyIfsgPreset(db, 1, 'rnk_2024', false, NOW)
      const id = create({ disease: 'hepatitis_a', onsetDate: '2026-11-10', ruleVariant: 'no_jaundice' })
      expect(rowOf(lena).ifsg).toMatchObject({ earliest: '2026-11-24', proof: 'parent_declaration' })
      expect(errorCode(() => readmitOn(id, TODAY))).toBe('ifsg_before_earliest')
    })

    it('refuses a back-dated „Kommt“ inside a ban that is over by now (M-9)', () => {
      const id = createIfsgCase(db, leitung, {
        childId: lena, date: '2026-11-16', disease: 'kopflaus', kind: 'sick', onsetDate: '2026-11-16', ruleVariant: null, ruleDate: null,
      }, berlin('2026-11-16'))
      readmitOn(id, '2026-11-18')
      const arriveOn = (date: string) => arrive(db, leitung, { childId: lena, date, time: hm('08:00'), plannedPickup: hm('15:00') }, NOW)
      expect(errorCode(() => arriveOn('2026-11-17'))).toBe('ifsg_readmission_required')
      expect(getAttendanceDay(db, leitung, '2026-11-17', NOW).children.find(child => child.childId === lena)!.ifsg)
        .toMatchObject({ caseId: id, canReadmit: false, readmittedOn: '2026-11-18' })
      expect(() => arriveOn('2026-11-15')).not.toThrow()
      expect(() => arriveOn(TODAY)).not.toThrow()
    })

    it('sends the report day and the stored rule, also when the rules no longer offer it (N-1, N-2)', () => {
      const id = create({ ruleVariant: 'onset' })
      applyIfsgPreset(db, 1, 'rnk_2024', false, NOW)
      const stored = { anchor: 'onset', days: 5, label: '', condition: 'und symptomfrei' }
      expect(rowOf(lena).ifsg).toMatchObject({ reportedOn: TODAY, ruleVariant: 'onset', rule: stored, earliest: '2026-11-22' })
      expect(listIfsgCases(db, leitung, 2026).find(item => item.id === id)?.rule).toEqual(stored)
    })

    it('counts only ill or suspected children for a cluster (M-5)', () => {
      create({ disease: 'masern' })
      create({ childId: max, disease: 'masern', kind: 'household' })
      expect(ifsgClusterReminders(db, leitung, TODAY)).toEqual([])
    })

    it('does not add a preset disease whose name exists already (M-8)', () => {
      addLocalDisease(db, 1, { name: 'Covid 19', notifiable: false }, NOW)
      expect(applyIfsgPreset(db, 1, 'rnk_2024', false, NOW)).toBe(35)
      expect(localRulesOverview(db, 1).rows.filter(row => /covid/i.test(row.merged.name)).map(row => row.key)).toEqual(['local_covid_19'])
    })

    it('keeps the legal notification duty of an RKI disease (M-6)', () => {
      saveLocalRule(db, 1, 'kopflaus', { notify: false, proof: 'parent_declaration' }, NOW)
      expect(localRulesOverview(db, 1).rows.find(row => row.key === 'kopflaus')).toMatchObject({ local: { notify: null }, merged: { notify: true } })
      create({ disease: 'kopflaus' })
      expect(ifsgReminders(db, leitung, TODAY)).toHaveLength(1)
    })

    it("prints the parents' confirmation of the treatment for head lice (M-7)", () => {
      const id = create({ disease: 'kopflaus' })
      expect(ifsgDeclaration(db, leitung, id).form).toBe('lice')
      expect(ifsgDeclaration(db, leitung, create({ childId: max })).form).toBe('declaration')
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
