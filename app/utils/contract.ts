import { seniority } from '#shared/domain/tvoed'
import type { EmployeeContractDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * One line such as "Pers.-Nr. 1234 · Erzieher/in · S 8a, Stufe 3 · seit 01.03.2019 (7 J. 7 Mon.) · befristet bis
 * 31.07.2027"; empty when nothing is entered.
 */
export function contractSummary(contract: EmployeeContractDto, today: string): string {
  const job = contract.jobKey === 'other' ? contract.jobOther : contract.jobKey ? de.contract.jobs[contract.jobKey] : null
  const pay = [contract.payGroup, contract.payLevel !== null ? de.contract.level(contract.payLevel) : null].filter(Boolean).join(', ')
  const since = contract.employedSince
    ? de.contract.since(formatDate(contract.employedSince), seniority(contract.employedSince, today))
    : null
  const number = contract.personnelNumber ? de.contract.personnelNumberShort(contract.personnelNumber) : null
  const fixedTerm = contract.fixedTermUntil ? de.contract.fixedTermShort(formatDate(contract.fixedTermUntil)) : null
  return [number, job, pay, since, fixedTerm].filter(Boolean).join(' · ')
}
