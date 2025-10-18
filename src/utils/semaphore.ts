/**
 * Semaphore - Limit concurrency
 */
export class Semaphore {
    private running = 0
    private waiting: Array<() => void> = []

    constructor(private readonly limit: number) {
        if (limit <= 0) {
            throw new Error('Concurrency limit must be greater than 0')
        }
    }

    /**
     * Acquire semaphore
     *
     * @returns Release function
     */
    async acquire(): Promise<() => void> {
        while (this.running >= this.limit) {
            await new Promise<void>((resolve) => this.waiting.push(resolve))
        }

        this.running++

        return () => {
            this.running--
            const next = this.waiting.shift()
            if (next) {
                next()
            }
        }
    }

    /**
     * Run async function (auto-manage semaphore)
     *
     * @param fn Async function
     * @returns Function execution result
     */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        const release = await this.acquire()
        try {
            return await fn()
        } finally {
            release()
        }
    }
}
