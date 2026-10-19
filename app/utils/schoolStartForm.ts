/**
 * The school start input of the master form for Leitung and Träger. `value` is the date in the input ('' = automatic),
 * `prefill` the computed date „Ändern“ put into it for a child without a school start by hand ('' = none). As long as
 * the input still holds that prefill, nothing was chosen: the school start stays automatic and follows the birth date.
 */
export interface SchoolStartInput {
  value: string
  prefill: string
}

/** „Ändern“: a school start set by hand stays; otherwise the input starts from the computed one (`computed`, '' = none yet). */
export function openSchoolStart(input: SchoolStartInput, computed: string): SchoolStartInput {
  return input.value === '' ? { value: computed, prefill: computed } : { value: input.value, prefill: '' }
}

/** Another computed school start (birth date changed): an untouched prefill moves along, a chosen date stays. */
export function resyncSchoolStart(input: SchoolStartInput, computed: string): SchoolStartInput {
  return input.prefill !== '' && input.value === input.prefill ? { value: computed, prefill: computed } : input
}

/** „Wieder automatisch“. */
export function automaticSchoolStart(): SchoolStartInput {
  return { value: '', prefill: '' }
}

/** The school start to save: null (automatic) for an empty input or an untouched prefill, else the chosen date. */
export function schoolStartToSave(input: SchoolStartInput): string | null {
  return input.value === '' || input.value === input.prefill ? null : input.value
}
