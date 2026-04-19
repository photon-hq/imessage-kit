/**
 * Async control flow utilities.
 *
 * Delay, retry with exponential backoff, and concurrency limiting.
 */

// -----------------------------------------------
// Delay
// -----------------------------------------------

/** Delay for the specified milliseconds. Supports AbortSignal cancellation. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error('Aborted'))
            return
        }

        const cleanup = () => {
            clearTimeout(id)
            signal?.removeEventListener('abort', onAbort)
        }

        const onAbort = () => {
            cleanup()
            reject(signal?.reason ?? new Error('Aborted'))
        }

        const id = setTimeout(() => {
            cleanup()
            resolve()
        }, ms)

        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

// -----------------------------------------------
// Retry
// -----------------------------------------------

export interface RetryOptions {
    /** Maximum number of attempts (default: 3). */
    readonly attempts?: number
    /** Base delay in ms between retries (default: 1000). */
    readonly delay?: number
    /** Use exponential backoff (default: true). */
    readonly backoff?: boolean
    /** Maximum delay cap in ms (default: 30000). */
    readonly maxDelay?: number
    /** AbortSignal for cancellation. */
    readonly signal?: AbortSignal
}

/**
 * Retry an async operation with exponential backoff and full jitter.
 *
 * Throws the last error if all attempts fail.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const attempts = Math.max(1, Math.trunc(options.attempts ?? 3))
    const baseDelay = Math.max(0, options.delay ?? 1_000)
    const backoff = options.backoff ?? true
    const maxDelay = Math.max(baseDelay, options.maxDelay ?? 30_000)
    const { signal } = options

    let lastError: Error | undefined

    for (let attempt = 0; attempt < attempts; attempt++) {
        if (signal?.aborted) throw signal.reason ?? new Error('Aborted')

        try {
            return await fn()
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))

            // If the caller aborted, surface the abort reason — not the
            // fn's internal error — so callers can distinguish cancellation
            // from a genuine fn failure.
            if (signal?.aborted) throw signal.reason ?? new Error('Aborted')

            if (attempt < attempts - 1) {
                const exponential = backoff ? baseDelay * 2 ** attempt : baseDelay
                const capped = Math.min(exponential, maxDelay)
                await delay(Math.random() * capped, signal)
            }
        }
    }

    throw lastError
}

// -----------------------------------------------
// Semaphore
// -----------------------------------------------

/** Limits concurrent async operations. */
export class Semaphore {
    private running = 0
    private readonly waiting: Array<() => void> = []

    constructor(private readonly limit: number) {
        if (limit <= 0) throw new Error('Concurrency limit must be greater than 0')
    }

    /**
     * Acquire a slot. Returns a release function.
     *
     * Slot-transfer semantics guarantee strict FIFO fairness:
     * a waiter that is woken up has had the slot handed to it directly,
     * so there is no re-check race where a late-arriving caller could
     * jump ahead. The release function either transfers the slot to the
     * next waiter (running unchanged) or decrements the counter.
     */
    async acquire(signal?: AbortSignal): Promise<() => void> {
        if (signal?.aborted) throw signal.reason ?? new Error('Aborted')

        if (this.running >= this.limit) {
            await new Promise<void>((resolve, reject) => {
                const onAbort = () => {
                    const idx = this.waiting.indexOf(wrappedResolve)
                    if (idx !== -1) this.waiting.splice(idx, 1)
                    reject(signal?.reason ?? new Error('Aborted'))
                }

                const wrappedResolve = () => {
                    signal?.removeEventListener('abort', onAbort)
                    resolve()
                }

                signal?.addEventListener('abort', onAbort, { once: true })
                this.waiting.push(wrappedResolve)
            })
            // Woken == slot was handed to us by a releaser; do not ++running.
        } else {
            this.running++
        }

        let released = false
        return () => {
            if (released) return
            released = true
            const next = this.waiting.shift()
            if (next) {
                next() // Transfer slot to next waiter; running stays the same.
            } else {
                this.running--
            }
        }
    }

    /** Execute fn within a concurrency slot. */
    async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const release = await this.acquire(signal)

        try {
            return await fn()
        } finally {
            release()
        }
    }
}
