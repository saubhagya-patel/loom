// Prisma accepts no AbortSignal, so a wedged database has to be raced rather
// than cancelled: without this, /healthz hangs instead of answering 503.
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer))
}
