import { describe, expect, it } from 'vitest'
import { effectivePermissions, type PermissionKey } from '../../shared/domain/permissions'
import type { EmployeePayrollDto } from '../../shared/types/api'
import {
  FULL_MASK, employeeDocumentUrl, fieldErrorOf, formatIban, fullBirthDate, maskIban, maskTail, payrollDisplay, payrollFieldsOf,
  payrollFormChanged, payrollInput, personalFieldsOf, personalInput, sensitiveFieldsOf, sensitiveInput, visibleFolders,
} from '../../app/utils/personnel'

const payroll: EmployeePayrollDto = {
  taxId: '86095742719', taxClass: 1, svNumber: '15070649C103', healthInsurer: 'AOK', iban: 'DE89370400440532013000',
  accountHolder: 'Jana Müller', denomination: 'rk',
}

describe('IBAN display', () => {
  it('groups an IBAN in fours, whatever was typed', () => {
    expect(formatIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00')
    expect(formatIban(' de89 3704 004405320130 00 ')).toBe('DE89 3704 0044 0532 0130 00')
    expect(formatIban('')).toBe('')
    expect(formatIban(null)).toBe('')
  })

  it('masks all but the country code and the last four', () => {
    expect(maskIban('DE89370400440532013000')).toBe('DE•• •••• •••• •••• •• 3000')
    expect(maskIban('NL91ABNA0417164300')).toBe('NL•• •••• •••• •• 4300')
    expect(maskIban('DE12')).toBe('••••')
    expect(maskIban(null)).toBe('')
    expect(maskIban('DE89370400440532013000')).not.toContain('8937')
  })
})

describe('masking with the last characters visible', () => {
  it('shows only the tail, without spaces', () => {
    expect(maskTail('86095742719', 3)).toBe('••••••••719')
    expect(maskTail('15 070649 C 103', 3)).toBe('•••••••••103')
    expect(maskTail('12', 3)).toBe('••')
    expect(maskTail('', 3)).toBe('')
  })

  it('shows each payroll value masked or in full', () => {
    expect(payrollDisplay(payroll, 'iban', false)).toBe('DE•• •••• •••• •••• •• 3000')
    expect(payrollDisplay(payroll, 'iban', true)).toBe('DE89 3704 0044 0532 0130 00')
    expect(payrollDisplay(payroll, 'taxId', false)).toBe('••••••••719')
    expect(payrollDisplay(payroll, 'taxId', true)).toBe('86095742719')
    expect(payrollDisplay(payroll, 'svNumber', false)).toBe('•••••••••103')
    expect(payrollDisplay(payroll, 'denomination', false)).toBe(FULL_MASK)
    expect(payrollDisplay(payroll, 'denomination', true)).toBe('rk')
    expect(payrollDisplay(payroll, 'taxClass', false)).toBe(FULL_MASK)
    expect(payrollDisplay(payroll, 'taxClass', true)).toBe('1')
    expect(payrollDisplay(payroll, 'healthInsurer', false)).toBe('AOK')
    expect(payrollDisplay({ ...payroll, iban: null }, 'iban', false)).toBeNull()
  })
})

describe('payroll form', () => {
  it('starts from the saved values (IBAN grouped) or empty', () => {
    expect(payrollFieldsOf(payroll).iban).toBe('DE89 3704 0044 0532 0130 00')
    expect(payrollFieldsOf(null)).toEqual({
      taxId: '', taxClass: 0, svNumber: '', healthInsurer: '', iban: '', accountHolder: '', denomination: '',
    })
  })

  it('sends trimmed values, empty as null', () => {
    const fields = { ...payrollFieldsOf(null), healthInsurer: '  TK ', iban: 'DE89 3704 0044 0532 0130 00', taxClass: 3 }
    expect(payrollInput(fields)).toEqual({
      value: {
        taxId: null, taxClass: 3, svNumber: null, healthInsurer: 'TK', iban: 'DE89 3704 0044 0532 0130 00', accountHolder: null,
        denomination: null,
      },
    })
  })

  it('names the field of each format error', () => {
    const fields = { ...payrollFieldsOf(payroll), taxId: '86095742710', svNumber: '15070649C104', iban: 'DE89370400440532013001' }
    expect(payrollInput(fields)).toEqual({ errors: { taxId: 'tax_id_invalid', svNumber: 'sv_number_invalid', iban: 'iban_invalid' } })
  })

  it('tells whether the form differs from what is stored (IBAN grouping is no change)', () => {
    expect(payrollFormChanged(payrollFieldsOf(payroll), payroll)).toBe(false)
    expect(payrollFormChanged({ ...payrollFieldsOf(payroll), iban: 'DE89370400440532013000' }, payroll)).toBe(false)
    expect(payrollFormChanged({ ...payrollFieldsOf(payroll), taxClass: 3 }, payroll)).toBe(true)
    expect(payrollFormChanged(payrollFieldsOf(null), null)).toBe(false)
    expect(payrollFormChanged({ ...payrollFieldsOf(null), healthInsurer: 'TK' }, null)).toBe(true)
  })

  it('maps a server error code to its field', () => {
    expect(fieldErrorOf('iban_invalid')).toEqual({ iban: 'iban_invalid' })
    expect(fieldErrorOf('email_invalid')).toEqual({ email: 'email_invalid' })
    expect(fieldErrorOf('invalid_date')).toEqual({ disabilityUntil: 'invalid_date' })
    expect(fieldErrorOf('forbidden')).toEqual({})
    expect(fieldErrorOf(undefined)).toEqual({})
  })
})

describe('personal and sensitive blocks', () => {
  it('turns the form into the personal block', () => {
    const fields = { ...personalFieldsOf(undefined), birthYear: '1985', street: ' Hauptstr. 1 ', postalCode: '12345', email: '' }
    expect(personalInput(fields)).toEqual({
      value: { birthYear: 1985, street: 'Hauptstr. 1', postalCode: '12345', city: null, phone: null, email: null },
    })
    expect(personalInput({ ...fields, birthYear: '' })).toMatchObject({ value: { birthYear: null } })
    expect(personalInput({ ...fields, birthYear: '85' })).toEqual({ error: 'birth_year_invalid' })
    expect(personalInput({ ...fields, birthYear: '19x5' })).toEqual({ error: 'birth_year_invalid' })
  })

  it('reads the saved block', () => {
    expect(personalFieldsOf({
      birthYear: 1985, birthDate: '1985-03-12', street: 'A', postalCode: '1', city: 'B', phone: 'C', email: 'D',
    })).toEqual({ birthYear: '1985', street: 'A', postalCode: '1', city: 'B', phone: 'C', email: 'D' })
  })

  it('forms the full birth date only from a real day, month and year', () => {
    expect(fullBirthDate(12, 3, '1985')).toBe('1985-03-12')
    expect(fullBirthDate(29, 2, '1984')).toBe('1984-02-29')
    expect(fullBirthDate(29, 2, '1985')).toBeNull()
    expect(fullBirthDate(0, 3, '1985')).toBeNull()
    expect(fullBirthDate(12, 3, '')).toBeNull()
  })

  it('sends the disability details only with „Schwerbehinderung“', () => {
    const on = { nationality: ' deutsch ', disability: true, disabilityDegree: 50, disabilityEqual: true, disabilityUntil: '2028-12-31' }
    expect(sensitiveInput(on)).toEqual({
      nationality: 'deutsch', disability: true, disabilityDegree: 50, disabilityEqual: true, disabilityUntil: '2028-12-31',
    })
    expect(sensitiveInput({ ...on, disability: false })).toEqual({
      nationality: 'deutsch', disability: false, disabilityDegree: null, disabilityEqual: false, disabilityUntil: null,
    })
    expect(sensitiveInput({ ...sensitiveFieldsOf(undefined), disability: true })).toEqual({
      nationality: null, disability: true, disabilityDegree: null, disabilityEqual: false, disabilityUntil: null,
    })
  })
})

describe('document folders', () => {
  const canOf = (role: 'provider' | 'admin' | 'observer') => {
    const permissions = effectivePermissions({ role, canEditChildren: false, isLeavePlanner: false, contractVisibleToAdmins: false })
    return (key: PermissionKey) => permissions.has(key)
  }

  it('shows the Träger every folder, the Leitung only qualifications, a Mitarbeiter none', () => {
    expect(visibleFolders(canOf('provider'))).toEqual(['contract', 'application', 'qualifications', 'correspondence', 'measures', 'salary'])
    expect(visibleFolders(canOf('admin'))).toEqual(['qualifications'])
    expect(visibleFolders(canOf('observer'))).toEqual([])
  })

  it('links to the file, inline or as a download', () => {
    expect(employeeDocumentUrl(7)).toBe('/api/employee-documents/7')
    expect(employeeDocumentUrl(7, true)).toBe('/api/employee-documents/7?download=1')
  })
})
