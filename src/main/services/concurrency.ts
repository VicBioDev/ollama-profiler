export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        const item = items[index]
        if (item !== undefined) {
          await worker(item, index)
        }
      }
    })
  )
}

export class KeyedSerialExecutor {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    this.tails.set(key, tail)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release?.()
      if (this.tails.get(key) === tail) {
        this.tails.delete(key)
      }
    }
  }
}
