import { isPlausibleTrainingUntil, levelStart, seniority } from '#shared/domain/tvoed'
import type { IsoDate } from '#shared/domain/types'
import type { EmployeeContractDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

type LevelYearsFields = Pick<EmployeeContractDto, 'employedSince' | 'trainingUntil' | 'recognitionYearCounts'>

/**
 * „Stufenjahre ab 01.08.2024 (nach Ausbildung)“ or „… (Anerkennungsjahr als Stufe 1)“ when the level years start
 * later than „In der Einrichtung seit“ (see levelStart); null when they start with the employment.
 */
export function levelYearsNote(contract: LevelYearsFields): string | null {
  if (!contract.employedSince) return null
  const since = levelStart(contract.employedSince, contract.trainingUntil, contract.recognitionYearCounts)
  if (since === contract.employedSince) return null
  return de.contract.levelYearsFrom(formatDate(since), contract.recognitionYearCounts ? 'recognition' : 'training')
}

/**
 * Saving asks whether the recognition year counts as level 1 when a training end was entered or changed, and only for
 * a date the server takes (an invalid one goes on and comes back with the German error instead).
 */
export function askRecognitionYear(savedTrainingUntil: string | null, trainingUntil: string | null, today: IsoDate): boolean {
  return trainingUntil !== null && trainingUntil !== savedTrainingUntil && isPlausibleTrainingUntil(trainingUntil, today)
}

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
  return [number, job, pay, since, levelYearsNote(contract), fixedTerm].filter(Boolean).join(' · ')
}
