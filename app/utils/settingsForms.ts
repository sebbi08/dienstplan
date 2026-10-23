import { formatTime, parseTime } from '#shared/domain/time'

/** A stored time as the settings forms show it ('' for none). */
export const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))

/** Empty = no time; undefined = typed but not a valid time. */
export const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

/**
 * The rows of a settings table after the server's list was read again (any section's save reloads the shared data).
 * `built` holds what each row was last built from (as JSON, by id). A row with unsaved edits (it differs from that)
 * keeps them unless it was just saved; every other row takes the fresh values. Rows follow the fresh list: new ones
 * come in, deleted ones go.
 */
export function mergeRows<Form extends { id: number | null }>(
  current: readonly Form[], built: ReadonlyMap<number, string>, fresh: readonly Form[], saved: ReadonlySet<number> = new Set(),
): Form[] {
  const byId = new Map<number, Form>()
  for (const form of current) if (form.id !== null) byId.set(form.id, form)
  return fresh.map((row) => {
    const form = row.id === null ? undefined : byId.get(row.id)
    const edited = form !== undefined && row.id !== null && built.has(row.id) && JSON.stringify(form) !== built.get(row.id)
    return edited && !saved.has(row.id!) ? form : row
  })
}

/** What `mergeRows` compares with next time: each fresh row as JSON, by id. */
export function builtRows(fresh: readonly { id: number | null }[]): Map<number, string> {
  const built = new Map<number, string>()
  for (const row of fresh) if (row.id !== null) built.set(row.id, JSON.stringify(row))
  return built
}

/**
 * A typed time for comparing a form with the stored value: the minutes (null when empty), or the text itself while it is
 * not a valid time (so it always counts as a change).
 */
export function timeKey(value: string): number | null | string {
  const minutes = optionalTime(value)
  return minutes === undefined ? `?${value}` : minutes
}
