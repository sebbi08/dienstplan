/** Expected business error; handlers translate it into an HTTP error with `data.code`. */
export class ServiceError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) {
    super(code)
    this.name = 'ServiceError'
  }
}
