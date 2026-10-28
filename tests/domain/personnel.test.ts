import { describe, expect, it } from 'vitest'
import { PERMISSION_KEYS } from '../../shared/domain/permissions'
import {
  birthYearError, disabilityDegreeError, EMPLOYEE_DOCUMENT_FOLDERS, emailError, FOLDER_PERMISSION, FOLDER_RETENTION,
  ibanError, normalizeIban, normalizeSvNumber, normalizeTaxId, postalCodeError, svNumberError, taxClassError, taxIdError,
} from '../../shared/domain/personnel'
import { de } from '../../app/locales/de'

describe('IBAN', () => {
  it('accepts valid IBANs with or without spaces, in any case', () => {
    expect(ibanError('DE89370400440532013000')).toBeNull()
    expect(ibanError('DE89 3704 0044 0532 0130 00')).toBeNull()
    expect(ibanError(' de89 3704 0044 0532 0130 00 ')).toBeNull()
    expect(ibanError('GB82WEST12345698765432')).toBeNull()
    expect(ibanError('AT611904300234573201')).toBeNull()
    expect(ibanError('NL91ABNA0417164300')).toBeNull()
  })

  it('accepts an empty value', () => {
    for (const empty of ['', '   ', null, undefined]) expect(ibanError(empty)).toBeNull()
  })

  it('rejects a wrong check sum, a wrong German length, a bad shape', () => {
    expect(ibanError('DE89370400440532013001')).toBe('iban_invalid')
    expect(ibanError('DE88370400440532013000')).toBe('iban_invalid')
    expect(ibanError('DE8937040044053201300')).toBe('iban_invalid')
    expect(ibanError('DE893704004405320130000')).toBe('iban_invalid')
    expect(ibanError('89370400440532013000DE')).toBe('iban_invalid')
    expect(ibanError('DE89-3704-0044-0532-0130-00')).toBe('iban_invalid')
    expect(ibanError('DE89')).toBe('iban_invalid')
    expect(ibanError('XX82WEST1234569876543212345678901234')).toBe('iban_invalid')
  })

  it('normalises to upper case without spaces', () => {
    expect(normalizeIban(' de89 3704 0044 0532 0130 00 ')).toBe('DE89370400440532013000')
  })
})

describe('Steuer-ID', () => {
  it('accepts 11 digits with the right check digit (ISO 7064 MOD 11,10)', () => {
    for (const id of ['86095742719', '47036892816', '65929970489', '57549285017', '25768131411']) expect(taxIdError(id), id).toBeNull()
    expect(taxIdError('86 095 742 719')).toBeNull()
  })

  it('accepts an empty value', () => {
    for (const empty of ['', ' ', null, undefined]) expect(taxIdError(empty)).toBeNull()
  })

  it('rejects a wrong check digit, a wrong length, a leading zero, letters', () => {
    expect(taxIdError('86095742710')).toBe('tax_id_invalid')
    expect(taxIdError('86095742718')).toBe('tax_id_invalid')
    expect(taxIdError('8609574271')).toBe('tax_id_invalid')
    expect(taxIdError('860957427190')).toBe('tax_id_invalid')
    expect(taxIdError('06095742719')).toBe('tax_id_invalid')
    expect(taxIdError('8609574271A')).toBe('tax_id_invalid')
  })

  it('normalises without spaces', () => {
    expect(normalizeTaxId(' 86 095 742 719 ')).toBe('86095742719')
  })
})

describe('SV-Nummer', () => {
  it('accepts 2 + 6 digits, a letter and 3 digits with the right check digit, spaces and case aside', () => {
    expect(svNumberError('15070649C103')).toBeNull()
    expect(svNumberError('15 070649 C 103')).toBeNull()
    expect(svNumberError('15070649c103')).toBeNull()
  })

  it('accepts an empty value', () => {
    for (const empty of ['', ' ', null, undefined]) expect(svNumberError(empty)).toBeNull()
  })

  it('rejects a wrong check digit, a wrong length or shape', () => {
    expect(svNumberError('15070649C104')).toBe('sv_number_invalid')
    expect(svNumberError('15070649C10')).toBe('sv_number_invalid')
    expect(svNumberError('15070649C1033')).toBe('sv_number_invalid')
    expect(svNumberError('150706491103')).toBe('sv_number_invalid')
    expect(svNumberError('1507064CC103')).toBe('sv_number_invalid')
    expect(svNumberError('15070649Ä103')).toBe('sv_number_invalid')
  })

  it('normalises to upper case without spaces', () => {
    expect(normalizeSvNumber(' 15 070649 c 103 ')).toBe('15070649C103')
  })
})

describe('the other fields', () => {
  it('tax class 1 to 6, whole numbers; empty allowed', () => {
    for (const taxClass of [1, 2, 3, 4, 5, 6]) expect(taxClassError(taxClass)).toBeNull()
    expect(taxClassError(null)).toBeNull()
    expect(taxClassError(undefined)).toBeNull()
    for (const taxClass of [0, 7, 2.5, -1, Number.NaN]) expect(taxClassError(taxClass), String(taxClass)).toBe('tax_class_invalid')
  })

  it('e-mail of the basic shape; empty allowed', () => {
    expect(emailError('anna@example.de')).toBeNull()
    expect(emailError(' anna.muster+kita@mail.example.com ')).toBeNull()
    expect(emailError('')).toBeNull()
    expect(emailError(null)).toBeNull()
    for (const email of ['anna', 'anna@', '@example.de', 'anna@example', 'an na@example.de', 'anna@@example.de']) {
      expect(emailError(email), email).toBe('email_invalid')
    }
  })

  it('PLZ of 5 digits; empty allowed', () => {
    expect(postalCodeError('80331')).toBeNull()
    expect(postalCodeError(' 01067 ')).toBeNull()
    expect(postalCodeError('')).toBeNull()
    expect(postalCodeError(null)).toBeNull()
    for (const code of ['8033', '803311', '8033A', 'A-1010']) expect(postalCodeError(code), code).toBe('postal_code_invalid')
  })

  it('degree of disability 20 to 100 in steps of 10; empty allowed', () => {
    for (const degree of [20, 30, 50, 100]) expect(disabilityDegreeError(degree)).toBeNull()
    expect(disabilityDegreeError(null)).toBeNull()
    for (const degree of [0, 10, 25, 110, 55.5]) expect(disabilityDegreeError(degree), String(degree)).toBe('disability_degree_invalid')
  })

  it('birth year from 1900 to this year, the date with the birthday must exist; empty allowed', () => {
    expect(birthYearError(1985, '04-12', 2026)).toBeNull()
    expect(birthYearError(1984, '02-29', 2026)).toBeNull()
    expect(birthYearError(2026, null, 2026)).toBeNull()
    expect(birthYearError(null, '04-12', 2026)).toBeNull()
    expect(birthYearError(1985, '02-29', 2026)).toBe('birth_year_invalid')
    expect(birthYearError(1899, null, 2026)).toBe('birth_year_invalid')
    expect(birthYearError(2027, null, 2026)).toBe('birth_year_invalid')
    expect(birthYearError(1985.5, null, 2026)).toBe('birth_year_invalid')
  })

  it('has a German text for every error code, also as API error', () => {
    const codes = ['iban_invalid', 'tax_id_invalid', 'sv_number_invalid', 'tax_class_invalid', 'email_invalid',
      'postal_code_invalid', 'disability_degree_invalid', 'birth_year_invalid'] as const
    for (const code of codes) {
      expect(de.personnel.invalid[code].length, code).toBeGreaterThan(10)
      expect(de.errors[code], code).toBe(de.personnel.invalid[code])
    }
  })
})

describe('document folders', () => {
  it('has the six folders, each with its own grantable key and retention category', () => {
    expect([...EMPLOYEE_DOCUMENT_FOLDERS]).toEqual(['contract', 'application', 'qualifications', 'correspondence', 'measures', 'salary'])
    for (const folder of EMPLOYEE_DOCUMENT_FOLDERS) {
      expect(FOLDER_PERMISSION[folder]).toBe(`employees.docs.${folder}`)
      expect(PERMISSION_KEYS).toContain(FOLDER_PERMISSION[folder])
      expect(de.personnel.folders[folder].length, folder).toBeGreaterThan(3)
    }
    expect(FOLDER_RETENTION).toEqual({
      contract: 'paidOvertime', application: 'assessment', qualifications: 'assessment', correspondence: 'assessment',
      measures: 'assessment', salary: 'paidOvertime',
    })
  })
})
