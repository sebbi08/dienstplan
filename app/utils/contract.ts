import { seniority } from '#shared/domain/tvoed'
import type { EmployeeContractDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** One line such as "Erzieher/in · S 8a, Stufe 3 · seit 01.03.2019 (7 J. 7 Mon.)"; '' when nothing is entered. */
export function contractSummary(contract: EmployeeContractDto, today: string): string {
  const job = contract.jobKey === 'other' ? contract.jobOther : contract.jobKey ? de.contract.jobs[contract.jobKey] : null
  const pay = [contract.payGroup, contract.payLevel !== null ? de.contract.level(contract.payLevel) : null].filter(Boolean).join(', ')
  const since = contract.employedSince
    ? de.contract.since(formatDate(contract.employedSince), seniority(contract.employedSince, today))
    : null
  return [job, pay, since].filter(Boolean).join(' · ')
}
