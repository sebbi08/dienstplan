/** Expected business error; handlers translate it into an HTTP error with `data.code` (and `data.details`, if any). */
export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'ServiceError'
  }
}
