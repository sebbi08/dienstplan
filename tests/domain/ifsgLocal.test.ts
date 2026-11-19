import { describe, expect, it } from 'vitest'
import { IFSG_CATALOGUE, earliestReadmission, ifsgDisease } from '../../shared/domain/ifsg'
import { emptyLocalRule, ifsgClusters, ifsgDifference, mergeIfsgRules, type IfsgLocalRule } from '../../shared/domain/ifsgLocal'
import { RNK_HEALTH_OFFICE, presetRules, rkiPreset, rnkPreset } from '../../shared/domain/ifsgPresets'

const local = (key: string, fields: Partial<IfsgLocalRule>): IfsgLocalRule => ({ ...emptyLocalRule(key), ...fields })
const merged = (locals: IfsgLocalRule[], key: string) => ifsgDisease(mergeIfsgRules(IFSG_CATALOGUE, locals), key)!
const rki = (key: string) => ifsgDisease(IFSG_CATALOGUE, key)!

describe('local rules of the health office over the RKI catalogue', () => {
  it('keeps the RKI rule where nothing is set locally', () => {
    expect(mergeIfsgRules(IFSG_CATALOGUE, [])).toEqual(IFSG_CATALOGUE)
    expect(merged([local('masern', {})], 'masern')).toEqual(rki('masern'))
  })

  it('takes each local field over the RKI one and leaves the others', () => {
    const masern = merged([local('masern', { proof: 'parent_declaration' })], 'masern')
    expect(masern.kinds.sick).toEqual({ ...rki('masern').kinds.sick, proof: 'parent_declaration', source: 'local' })
    expect(masern.source).toBe('local')
    expect(masern.kinds.household).toEqual(rki('masern').kinds.household)

    const text = merged([local('scharlach', { text: 'Nach 24 h.' })], 'scharlach')
    expect(text.kinds.sick).toMatchObject({ text: 'Nach 24 h.', proof: 'medical_certificate', rules: rki('scharlach').kinds.sick!.rules })

    const days = merged([local('mumps', { rules: [{ anchor: 'gland_swelling', days: 5, label: '' }] })], 'mumps')
    expect(days.kinds.sick!.rules).toEqual([{ key: 'gland_swelling_5', anchor: 'gland_swelling', days: 5, label: '', condition: '' }])
    expect(earliestReadmission(days.kinds.sick!.rules[0]!, '2026-11-01', '2026-11-03')).toBe('2026-11-08')
    // An empty list: no day can be computed any more.
    expect(merged([local('mumps', { rules: [] })], 'mumps').kinds.sick!.rules).toEqual([])

    // The notification duty of an RKI disease stands by law: a local „no“ does not switch it off.
    expect(merged([local('kopflaus', { notify: false })], 'kopflaus').notify).toBe(true)
    expect(merged([local('kopflaus', { note: 'Elternbrief beachten.' })], 'kopflaus').kinds.sick!.text).toMatch(/Wiederholungsbehandlung.*Elternbrief beachten\.$/)
  })

  it('keeps the conditions, stable rule keys, and says „laut RKI“ where nothing differs', () => {
    // A rule equal to the RKI's keeps its key and condition; reordering does not change the keys.
    const scharlach = merged([local('scharlach', { rules: [
      { anchor: 'symptom_end', days: 1, label: 'ohne' }, { anchor: 'antibiotic', days: 1, label: 'mit' },
    ] })], 'scharlach')
    expect(scharlach.kinds.sick!.rules.map(rule => [rule.key, rule.condition])).toEqual([['no_antibiotic', ''], ['antibiotic', 'und symptomfrei']])
    // An own condition wins, also an empty one.
    expect(merged([local('mumps', { rules: [{ anchor: 'onset', days: 5, label: '', condition: '' }] })], 'mumps').kinds.sick!.rules[0]!.condition).toBe('')
    expect(merged([local('mumps', { rules: [{ anchor: 'onset', days: 6, label: '', condition: 'und fieberfrei' }] })], 'mumps').kinds.sick!.rules[0])
      .toMatchObject({ key: 'onset_6', condition: 'und fieberfrei' })
    // The RKI copy says „laut RKI“ everywhere.
    expect(mergeIfsgRules(IFSG_CATALOGUE, rkiPreset()).every(disease => disease.source === 'rki')).toBe(true)
  })

  it('drops, adds or rewords the household rule', () => {
    expect(merged([local('masern', { householdExclusion: false })], 'masern').kinds.household).toBeUndefined()
    // Impetigo has no household rule at the RKI; the health office can add one.
    expect(merged([local('impetigo', { householdExclusion: true, householdText: 'Alle Geschwister.' })], 'impetigo').kinds.household)
      .toEqual({ text: 'Alle Geschwister.', proof: 'medical_certificate', rules: [], source: 'local' })
    expect(merged([local('mumps', { householdText: 'Nur nicht immune.' })], 'mumps').kinds.household)
      .toMatchObject({ text: 'Nur nicht immune.', rules: rki('mumps').kinds.household!.rules, source: 'local' })
  })

  it('adds local diseases after the catalogue: binding only when notifiable', () => {
    const rules = mergeIfsgRules(IFSG_CATALOGUE, [
      local('rsv', { custom: true, name: 'RSV', notifiable: false, notify: true, text: 'Bis genesen.' }),
      local('covid19', { custom: true, name: 'COVID-19', notifiable: true, notify: true, text: 'Bis genesen.', proof: 'parent_declaration' }),
    ])
    expect(rules.slice(24).map(disease => [disease.key, disease.binding, disease.notify])).toEqual([['covid19', true, true], ['rsv', false, false]])
    expect(rules[24]!.kinds.sick).toEqual({ text: 'Bis genesen.', proof: 'parent_declaration', rules: [], source: 'local' })
  })

  it('names what differs from the RKI: proof, days, notification, household, text', () => {
    expect(ifsgDifference(rki('masern'), rki('masern'))).toBeNull()
    const rnk = mergeIfsgRules(IFSG_CATALOGUE, rnkPreset())
    const mumps = ifsgDifference(rki('mumps'), ifsgDisease(rnk, 'mumps')!)!
    expect(mumps.proof).toEqual({ rki: 'medical_certificate', local: 'parent_declaration' })
    expect(mumps.days).toEqual({ rki: [{ anchor: 'onset', days: 5 }], local: [{ anchor: 'gland_swelling', days: 5 }] })
    expect(mumps.notify).toBeNull()
    const lice = ifsgDifference(rki('kopflaus'), ifsgDisease(rnk, 'kopflaus')!)!
    expect(lice.days).toEqual({ rki: [], local: [{ anchor: 'treatment', days: 0 }] })
    expect(ifsgDifference(null, ifsgDisease(rnk, 'rsv')!)).toBeNull()
    expect(ifsgDifference(rki('kopflaus'), merged([local('kopflaus', { notify: false })], 'kopflaus'))).toBeNull()
  })
})

describe('presets', () => {
  it('copies the RKI values into a local row per disease, which changes nothing', () => {
    expect(rkiPreset()).toHaveLength(24)
    expect(mergeIfsgRules(IFSG_CATALOGUE, rkiPreset()).map(disease => ({ ...disease, source: 'rki', kinds: Object.fromEntries(
      Object.entries(disease.kinds).map(([kind, rule]) => [kind, { ...rule, source: undefined, rules: rule!.rules.map(entry => ({ ...entry, key: '', condition: '' })) }]),
    ) }))).toEqual(IFSG_CATALOGUE.map(disease => ({ ...disease, kinds: Object.fromEntries(
      Object.entries(disease.kinds).map(([kind, rule]) => [kind, { ...rule, source: undefined, rules: rule!.rules.map(entry => ({ ...entry, key: '', condition: '' })) }]),
    ) })))
    expect(presetRules('rki')).toEqual(rkiPreset())
  })

  it('has every row of the Rhein-Neckar-Kreis document: the 24 diseases, COVID-19, RSV and 10 non-notifiable ones', () => {
    const rows = rnkPreset()
    expect(rows).toHaveLength(36)
    expect(rows.filter(row => !row.custom).map(row => row.key).sort()).toEqual(IFSG_CATALOGUE.map(disease => disease.key).sort())
    expect(rows.filter(row => row.custom).map(row => row.name)).toEqual([
      'COVID-19', 'RSV (Respiratorisches Synzytial-Virus)', 'Erkältung ohne Fieber', 'Grippaler Infekt mit Fieber (> 38 °C)', '3-Tage-Fieber',
      'Endemische Adenovirus-Bindehautentzündung', 'Hand-Fuß-Mund-Krankheit', 'Pfeiffersches Drüsenfieber', 'Ringelröteln', 'Dellwarzen',
      'Lippenherpes', 'Madenwürmer',
    ])
    expect(rows.filter(row => row.custom).every(row => row.notifiable === false && row.notify === false)).toBe(true)
    expect(RNK_HEALTH_OFFICE.phone).toBe('06221 522-1817')
  })

  it('reads the rows as the document says', () => {
    const rules = mergeIfsgRules(IFSG_CATALOGUE, rnkPreset())
    const of = (key: string) => ifsgDisease(rules, key)!
    expect(of('covid19')).toMatchObject({ name: 'COVID-19', binding: false, notify: false })
    expect(of('covid19').kinds.sick!.text).toMatch(/bis klinisch genesen.*Schnelltest/)
    expect(of('kopflaus').kinds.sick).toMatchObject({ proof: 'parent_declaration', rules: [{ anchor: 'treatment', days: 0, label: 'nach der ersten Behandlung' }] })
    expect(of('kopflaus').kinds.sick!.text).toMatch(/ersten von zwei Behandlungen/)
    expect(of('kopflaus').kinds.household).toBeUndefined()
    expect(of('masern').kinds.sick!.rules.map(rule => [rule.anchor, rule.days])).toEqual([['rash', 5]])
    expect(of('roeteln').kinds.sick!.rules.map(rule => [rule.anchor, rule.days])).toEqual([['rash', 8]])
    // The document names only the jaundice; the RKI rule without it stays (I-2), with stable keys.
    expect(of('hepatitis_a').kinds.sick!.rules.map(rule => [rule.key, rule.anchor, rule.days])).toEqual([['jaundice', 'jaundice', 7], ['no_jaundice', 'onset', 14]])
    // Where the document gives no days the RKI rules stay: Hib and Meningokokken 24 h after the antibiotic start.
    expect(of('hib').kinds.sick!.rules.map(rule => [rule.anchor, rule.days])).toEqual([['antibiotic', 1]])
    expect(of('meningokokken').kinds.sick!.rules.map(rule => [rule.anchor, rule.days, rule.condition])).toEqual([['antibiotic', 1, 'und genesen']])
    // Conditions stay where the document does not contradict them.
    expect(of('roeteln').kinds.sick!.rules[0]!.condition).toBe('und symptomfrei')
    expect(of('masern').kinds.sick!.rules[0]!.condition).toBe('')
    expect(of('hepatitis_e').kinds.sick).toMatchObject({ proof: 'parent_declaration', rules: [{ anchor: 'jaundice', days: 7 }] })
    expect(of('keuchhusten').kinds.sick!.rules.map(rule => [rule.anchor, rule.days])).toEqual([['antibiotic', 5], ['onset', 21]])
    expect(of('gastroenteritis').kinds.sick).toMatchObject({ proof: 'none', rules: [{ anchor: 'symptom_end', days: 2 }] })
    expect(of('skabies').kinds.sick).toMatchObject({ proof: 'parent_declaration' })
    expect(of('skabies').kinds.sick!.text).toMatch(/Wiederholungsfall ärztliches Attest/)
    expect(of('cholera').kinds.sick!.proof).toBe('health_office')
    expect(of('shigellose').kinds.sick!.text).toMatch(/2 negative Stuhlproben/)
    expect(of('windpocken').kinds.household!.text).toMatch(/nicht immune/)
    expect(of('hand_fuss_mund')).toMatchObject({ binding: false, notify: false, name: 'Hand-Fuß-Mund-Krankheit' })
  })
})

describe('clusters (§ 34 Abs. 6 Satz 2)', () => {
  const none = new Map<string, string>()
  it('reports two children with the same disease within 14 days, not 15', () => {
    expect(ifsgClusters([
      { disease: 'scharlach', childId: 1, reportedOn: '2026-11-01' }, { disease: 'scharlach', childId: 2, reportedOn: '2026-11-15' },
    ], none)).toEqual([{ disease: 'scharlach', count: 2, from: '2026-11-01', to: '2026-11-15' }])
    expect(ifsgClusters([
      { disease: 'scharlach', childId: 1, reportedOn: '2026-11-01' }, { disease: 'scharlach', childId: 2, reportedOn: '2026-11-16' },
    ], none)).toEqual([])
  })

  it('counts children, not cases, and other diseases apart; an acknowledgement covers up to its day', () => {
    const cases = [
      { disease: 'hand_fuss_mund', childId: 1, reportedOn: '2026-11-01' }, { disease: 'hand_fuss_mund', childId: 1, reportedOn: '2026-11-05' },
      { disease: 'kopflaus', childId: 2, reportedOn: '2026-11-05' },
    ]
    expect(ifsgClusters(cases, none)).toEqual([])
    const three = [...cases, { disease: 'hand_fuss_mund', childId: 3, reportedOn: '2026-11-10' }]
    expect(ifsgClusters(three, none)).toEqual([{ disease: 'hand_fuss_mund', count: 2, from: '2026-11-01', to: '2026-11-10' }])
    expect(ifsgClusters(three, new Map([['hand_fuss_mund', '2026-11-10']]))).toEqual([])
    // A new case after the acknowledgement brings the reminder back.
    expect(ifsgClusters([...three, { disease: 'hand_fuss_mund', childId: 4, reportedOn: '2026-11-12' }], new Map([['hand_fuss_mund', '2026-11-10']])))
      .toEqual([{ disease: 'hand_fuss_mund', count: 3, from: '2026-11-01', to: '2026-11-12' }])
  })
})
