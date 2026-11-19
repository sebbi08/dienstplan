import { describe, expect, it } from 'vitest'
import {
  IFSG_CATALOGUE, earliestReadmission, ifsgDateRule, ifsgDisease, ifsgKinds, type IfsgKind,
} from '../../shared/domain/ifsg'

/**
 * Table 1 of the RKI recommendations („Übersicht über Besuchs- und Tätigkeitsverbote gemäß § 34 IfSG“, Stand
 * 23.10.2026, page 4): which of Abs. 1 (erkrankt/Verdacht), Abs. 2 (Ausscheider) and Abs. 3 (Erkrankung in der
 * Wohngemeinschaft) apply to each of the 24 diseases.
 */
const TABLE_1: Record<string, (1 | 2 | 3)[]> = {
  tuberkulose: [1, 3],
  shigellose: [1, 2, 3],
  impetigo: [1],
  cholera: [1, 2, 3],
  diphtherie: [1, 2, 3],
  ehec: [1, 2, 3],
  hib: [1, 3],
  hepatitis_a: [1, 3],
  hepatitis_e: [1, 3],
  keuchhusten: [1],
  polio: [1, 3],
  kopflaus: [1],
  masern: [1, 3],
  meningokokken: [1, 3],
  mumps: [1, 3],
  orthopocken: [1],
  pest: [1, 3],
  roeteln: [1, 3],
  scharlach: [1],
  skabies: [1],
  typhus: [1, 2, 3],
  vhf: [1, 3],
  windpocken: [1, 3],
  gastroenteritis: [1],
}
const PARAGRAPH: Record<1 | 2 | 3, IfsgKind> = { 1: 'sick', 2: 'carrier', 3: 'household' }

/** The earliest readmission for the disease's kind and variant, counted from `date` (onset or the rule's own date). */
function earliest(key: string, kind: IfsgKind, variant: string | null, date: string): string | null {
  const disease = ifsgDisease(IFSG_CATALOGUE, key)!
  const rule = variant === null ? null : ifsgDateRule(disease, kind, variant)
  return earliestReadmission(rule, rule?.anchor === 'onset' ? date : '2000-01-01', rule?.anchor === 'onset' ? null : date)
}

describe('the § 34 IfSG catalogue (RKI, Stand 23.10.2026)', () => {
  it('has the 24 diseases of table 1, each with a unique key and name', () => {
    expect(IFSG_CATALOGUE).toHaveLength(24)
    expect(IFSG_CATALOGUE.map(disease => disease.key).sort()).toEqual(Object.keys(TABLE_1).sort())
    expect(new Set(IFSG_CATALOGUE.map(disease => disease.name)).size).toBe(24)
  })

  it('applies exactly the paragraphs of table 1 to every disease', () => {
    for (const disease of IFSG_CATALOGUE) {
      expect(ifsgKinds(disease), disease.key).toEqual(TABLE_1[disease.key]!.map(paragraph => PARAGRAPH[paragraph]))
    }
  })

  it('gives every kind a readmission text and a proof, carriers always the health office', () => {
    for (const disease of IFSG_CATALOGUE) {
      expect(disease.notify, disease.key).toBe(true)
      expect(disease.hint.length, disease.key).toBeGreaterThan(10)
      for (const kind of ifsgKinds(disease)) {
        const rule = disease.kinds[kind]!
        expect(rule.text.length, `${disease.key} ${kind}`).toBeGreaterThan(10)
        expect(['medical_certificate', 'health_office'], `${disease.key} ${kind}`).toContain(rule.proof)
        expect(new Set(rule.rules.map(entry => entry.key)).size, `${disease.key} ${kind}`).toBe(rule.rules.length)
      }
      if (disease.kinds.carrier) expect(disease.kinds.carrier.proof, disease.key).toBe('health_office')
    }
  })

  it('has no date rule where the readmission depends on lab results or the health office', () => {
    for (const key of ['cholera', 'diphtherie', 'ehec', 'hepatitis_e', 'pest', 'polio', 'shigellose', 'tuberkulose', 'typhus', 'vhf', 'kopflaus']) {
      expect(ifsgDisease(IFSG_CATALOGUE, key)!.kinds.sick!.rules, key).toEqual([])
    }
    for (const key of ['cholera', 'diphtherie', 'ehec', 'pest', 'polio', 'shigellose', 'typhus', 'vhf']) {
      expect(ifsgDisease(IFSG_CATALOGUE, key)!.kinds.sick!.proof, key).toBe('health_office')
    }
  })

  describe('date rules for the sick (boundaries: the day itself is the earliest)', () => {
    it.each([
      ['masern', 'rash', '2026-11-02', '2026-11-07'],
      ['windpocken', 'onset', '2026-11-02', '2026-11-09'],
      ['mumps', 'onset', '2026-11-02', '2026-11-07'],
      ['roeteln', 'rash', '2026-11-02', '2026-11-10'],
      ['keuchhusten', 'antibiotic', '2026-11-02', '2026-11-07'],
      ['keuchhusten', 'azithromycin', '2026-11-02', '2026-11-05'],
      ['keuchhusten', 'no_antibiotic', '2026-11-02', '2026-11-23'],
      ['scharlach', 'antibiotic', '2026-11-02', '2026-11-03'],
      ['scharlach', 'no_antibiotic', '2026-11-02', '2026-11-03'],
      ['impetigo', 'antibiotic', '2026-11-30', '2026-12-01'],
      ['gastroenteritis', 'symptom_end', '2026-12-31', '2027-01-02'],
      ['hib', 'antibiotic', '2026-11-02', '2026-11-03'],
      ['meningokokken', 'antibiotic', '2026-11-02', '2026-11-03'],
      ['skabies', 'topical', '2026-11-02', '2026-11-02'],
      ['skabies', 'ivermectin', '2026-11-02', '2026-11-03'],
      ['hepatitis_a', 'no_jaundice', '2026-11-02', '2026-11-16'],
      ['hepatitis_a', 'jaundice', '2026-11-02', '2026-11-09'],
      ['orthopocken', 'onset', '2026-11-02', '2026-11-23'],
    ])('%s (%s) from %s: earliest %s', (key, variant, date, expected) => {
      expect(earliest(key, 'sick', variant, date)).toBe(expected)
    })

    it('counts the onset rules from the onset and the others from their own date', () => {
      const masern = ifsgDisease(IFSG_CATALOGUE, 'masern')!
      const rash = ifsgDateRule(masern, 'sick', 'rash')!
      expect(rash.anchor).toBe('rash')
      // The rash onset is missing: no date yet; the onset alone does not count for it.
      expect(earliestReadmission(rash, '2026-11-01', null)).toBeNull()
      expect(earliestReadmission(rash, '2026-11-01', '2026-11-03')).toBe('2026-11-08')
      const mumps = ifsgDateRule(ifsgDisease(IFSG_CATALOGUE, 'mumps')!, 'sick', 'onset')!
      expect(earliestReadmission(mumps, '2026-11-01', '2026-11-20')).toBe('2026-11-06')
      // Without a chosen rule there is no date.
      expect(earliestReadmission(null, '2026-11-01', '2026-11-03')).toBeNull()
    })

    it('has rules without a date where the source names none (impetigo untreated, head lice)', () => {
      const impetigo = ifsgDisease(IFSG_CATALOGUE, 'impetigo')!
      expect(impetigo.kinds.sick!.rules.map(rule => rule.key)).toEqual(['antibiotic'])
      expect(impetigo.kinds.sick!.text).toMatch(/Abheilung/)
      expect(ifsgDisease(IFSG_CATALOGUE, 'kopflaus')!.kinds.sick!.text).toMatch(/Wiederholungsbehandlung/)
    })

    it('names the conditions besides the day', () => {
      const condition = (key: string, variant: string) => ifsgDateRule(ifsgDisease(IFSG_CATALOGUE, key)!, 'sick', variant)!.condition
      expect(condition('mumps', 'onset')).toMatch(/symptomfrei/)
      expect(condition('roeteln', 'rash')).toMatch(/symptomfrei/)
      expect(condition('scharlach', 'antibiotic')).toMatch(/symptomfrei/)
      expect(condition('hib', 'antibiotic')).toMatch(/genesen/)
      expect(condition('orthopocken', 'onset')).toMatch(/abgeheilt/)
      expect(ifsgDisease(IFSG_CATALOGUE, 'masern')!.kinds.sick!.text).toMatch(/ärztlicher Beurteilung/)
    })
  })

  describe('household contacts without immunity', () => {
    it.each([
      ['masern', 'last_contact', '2026-11-02', '2026-11-23'],
      ['mumps', 'last_contact', '2026-11-02', '2026-11-20'],
      ['windpocken', 'last_contact', '2026-11-02', '2026-11-18'],
      ['roeteln', 'last_contact', '2026-11-02', '2026-11-23'],
      ['hepatitis_a', 'last_contact', '2026-11-02', '2026-12-02'],
      ['meningokokken', 'last_contact', '2026-11-02', '2026-11-12'],
      ['meningokokken', 'prophylaxis', '2026-11-02', '2026-11-03'],
      ['hib', 'last_contact', '2026-11-02', '2026-11-12'],
      ['hib', 'prophylaxis', '2026-11-02', '2026-11-03'],
    ])('%s (%s) from %s: earliest %s', (key, variant, date, expected) => {
      expect(earliest(key, 'household', variant, date)).toBe(expected)
    })

    it('says that proven immunity means no exclusion', () => {
      for (const key of ['masern', 'mumps', 'windpocken', 'roeteln', 'hepatitis_a']) {
        expect(ifsgDisease(IFSG_CATALOGUE, key)!.kinds.household!.text, key).toMatch(/Immunität/)
      }
    })
  })

  it('finds no rule for an unknown disease, kind or variant', () => {
    expect(ifsgDisease(IFSG_CATALOGUE, 'grippe')).toBeNull()
    const impetigo = ifsgDisease(IFSG_CATALOGUE, 'impetigo')!
    expect(ifsgDateRule(impetigo, 'household', 'last_contact')).toBeNull()
    expect(ifsgDateRule(impetigo, 'sick', 'rash')).toBeNull()
  })
})
