export interface SerializedError {
  name: string
  message: string
  stack?: string
}

export function serializeError(error: unknown): SerializedError {
  const candidate = error as { name?: string; message?: string; stack?: string }
  return {
    name: candidate && candidate.name ? candidate.name : 'Error',
    message: candidate && candidate.message ? candidate.message : String(error),
    stack: candidate && candidate.stack ? candidate.stack : undefined,
  }
}
