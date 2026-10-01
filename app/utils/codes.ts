import type { CodeKey } from '#shared/domain/types'
import type { CodeDto } from '#shared/types/api'

/** Holidays are set automatically and closure days via "Schließzeiten", so they get no button. */
const AUTOMATIC_CODES: CodeKey[] = ['holiday', 'closure_day']

export function buttonCodes(codes: CodeDto[]): CodeDto[] {
  return codes.filter(code => !AUTOMATIC_CODES.includes(code.key))
}

export function codeButtonLabel(code: CodeDto): string {
  return code.requiresTimes ? `${code.label}…` : code.label
}
