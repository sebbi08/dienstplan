/** Usernames are compared case-insensitively: they are stored trimmed and in lower case. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}
