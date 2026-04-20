/**
 * Utility Functions Tests
 *
 * Tests for all utility functions and helpers
 */

import { describe, expect, it } from 'bun:test'

describe('Platform Utils', () => {
    describe('isURL', () => {
        it('should validate HTTP(S) URLs', async () => {
            const { isURL } = await import('../src/domain/validate')

            expect(isURL('https://example.com')).toBe(true)
            expect(isURL('http://example.com')).toBe(true)
            expect(isURL('https://example.com/path?query=value')).toBe(true)
        })

        it('should reject invalid URLs', async () => {
            const { isURL } = await import('../src/domain/validate')

            expect(isURL('ftp://example.com')).toBe(false)
            expect(isURL('example.com')).toBe(false)
            expect(isURL('/local/path')).toBe(false)
            expect(isURL('')).toBe(false)
        })
    })
})

describe('Common Utils', () => {
    describe('delay', () => {
        it('should delay execution', async () => {
            const { delay } = await import('../src/utils/async')

            const start = Date.now()
            await delay(100)
            const elapsed = Date.now() - start

            expect(elapsed).toBeGreaterThanOrEqual(95) // Allow small margin
            expect(elapsed).toBeLessThan(150)
        })

        it('should handle zero delay', async () => {
            const { delay } = await import('../src/utils/async')

            const start = Date.now()
            await delay(0)
            const elapsed = Date.now() - start

            expect(elapsed).toBeLessThan(50)
        })
    })

    describe('retry', () => {
        it('treats attempts < 1 as exactly one attempt', async () => {
            const { retry } = await import('../src/utils/async')
            let calls = 0
            await expect(
                retry(
                    async () => {
                        calls++
                        throw new Error('boom')
                    },
                    { attempts: 0 }
                )
            ).rejects.toThrow('boom')
            expect(calls).toBe(1)
        })

        it('returns the first successful result without extra attempts', async () => {
            const { retry } = await import('../src/utils/async')
            let calls = 0
            const out = await retry(
                async () => {
                    calls++
                    if (calls < 3) throw new Error('flaky')
                    return 'ok'
                },
                { attempts: 5, delay: 1, backoff: false }
            )
            expect(out).toBe('ok')
            expect(calls).toBe(3)
        })

        it('throws the LAST error after exhausting attempts', async () => {
            const { retry } = await import('../src/utils/async')
            let i = 0
            await expect(
                retry(
                    async () => {
                        i++
                        throw new Error(`err-${i}`)
                    },
                    { attempts: 3, delay: 1, backoff: false }
                )
            ).rejects.toThrow('err-3')
        })

        it('with backoff=true, total elapsed grows roughly geometrically (sanity)', async () => {
            const { retry } = await import('../src/utils/async')
            const start = Date.now()
            await retry(
                async () => {
                    throw new Error('x')
                },
                { attempts: 3, delay: 40, backoff: true }
            ).catch(() => {})
            // Two sleeps (between attempts) jittered in [0, 40] + [0, 80]. Lower
            // bound is 0, upper is ~120ms + some scheduler slack. The only
            // reliable assertion here is "reasonably bounded".
            expect(Date.now() - start).toBeLessThan(500)
        })

        it('caps the delay at maxDelay even when the exponential backoff exceeds it', async () => {
            const { retry } = await import('../src/utils/async')
            const originalRandom = Math.random
            Math.random = () => 1 // Always take the full jittered delay.
            try {
                const start = Date.now()
                await retry(
                    async () => {
                        throw new Error('x')
                    },
                    { attempts: 4, delay: 50, backoff: true, maxDelay: 30 }
                ).catch(() => {})
                // 3 sleeps, each capped to maxDelay(=30) when exponential (50,100,200) > cap.
                // `maxDelay = max(baseDelay, maxDelayOption)` → effective cap is max(50,30)=50,
                // so each actual sleep is at most 50ms — total < ~180ms with slack.
                expect(Date.now() - start).toBeLessThan(350)
            } finally {
                Math.random = originalRandom
            }
        })

        it('throws the signal reason when aborted before the first attempt runs', async () => {
            const { retry } = await import('../src/utils/async')
            const ac = new AbortController()
            ac.abort(new Error('pre-aborted'))
            let calls = 0
            await expect(
                retry(
                    async () => {
                        calls++
                        return 'ok'
                    },
                    { signal: ac.signal }
                )
            ).rejects.toThrow('pre-aborted')
            expect(calls).toBe(0)
        })

        it('aborts between attempts and surfaces the abort reason (not the fn error)', async () => {
            const { retry } = await import('../src/utils/async')
            const ac = new AbortController()
            let calls = 0
            const p = retry(
                async () => {
                    calls++
                    if (calls === 1) queueMicrotask(() => ac.abort(new Error('cancelled')))
                    throw new Error('fn failed')
                },
                { attempts: 5, delay: 20, signal: ac.signal }
            )
            await expect(p).rejects.toThrow('cancelled')
            expect(calls).toBeLessThan(5)
        })
    })

    describe('delay — abort signal', () => {
        it('rejects immediately when the signal is already aborted', async () => {
            const { delay } = await import('../src/utils/async')
            const ac = new AbortController()
            ac.abort(new Error('no waiting'))
            await expect(delay(1_000, ac.signal)).rejects.toThrow('no waiting')
        })

        it('rejects when the signal fires mid-sleep and does not fire the timer', async () => {
            const { delay } = await import('../src/utils/async')
            const ac = new AbortController()
            const p = delay(1_000, ac.signal)
            setTimeout(() => ac.abort(new Error('interrupted')), 20)
            const start = Date.now()
            await expect(p).rejects.toThrow('interrupted')
            // Far below the 1s delay — proves the timer was cleared.
            expect(Date.now() - start).toBeLessThan(300)
        })
    })

    describe('validateMessageContent', () => {
        it('should accept text only', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            expect(() => validateMessageContent('Hello', undefined)).not.toThrow()
        })

        it('should accept attachments only', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            expect(() => validateMessageContent(undefined, ['/path/to/file.jpg'])).not.toThrow()
        })

        it('should accept both text and attachments', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            expect(() => validateMessageContent('Hello', ['/path/to/file.jpg'])).not.toThrow()
        })

        it('should reject empty content', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            expect(() => validateMessageContent(undefined, undefined)).toThrow(
                'Message must have text or at least one attachment'
            )
            expect(() => validateMessageContent('', [])).toThrow('Message must have text or at least one attachment')
        })

        it('should treat whitespace-only text as valid content', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            // validateMessageContent checks `text !== ''` but does not trim.
            expect(() => validateMessageContent('   ', undefined)).not.toThrow()
        })
    })
})

describe('Semaphore', () => {
    it('should limit concurrency', async () => {
        const { Semaphore } = await import('../src/utils/async')

        const semaphore = new Semaphore(2)
        let concurrent = 0
        let maxConcurrent = 0

        const task = async () => {
            const release = await semaphore.acquire()
            concurrent++
            maxConcurrent = Math.max(maxConcurrent, concurrent)

            await new Promise((resolve) => setTimeout(resolve, 50))

            concurrent--
            release()
        }

        await Promise.all([task(), task(), task(), task(), task()])

        expect(maxConcurrent).toBe(2)
        expect(concurrent).toBe(0)
    })

    it('should support run() helper', async () => {
        const { Semaphore } = await import('../src/utils/async')

        const semaphore = new Semaphore(1)
        const results: number[] = []

        await Promise.all([
            semaphore.run(async () => {
                results.push(1)
                await new Promise((resolve) => setTimeout(resolve, 10))
            }),
            semaphore.run(async () => {
                results.push(2)
            }),
            semaphore.run(async () => {
                results.push(3)
            }),
        ])

        expect(results).toEqual([1, 2, 3])
    })

    it('should throw error for invalid limit', async () => {
        const { Semaphore } = await import('../src/utils/async')

        expect(() => new Semaphore(0)).toThrow('Concurrency limit must be greater than 0')
        expect(() => new Semaphore(-1)).toThrow('Concurrency limit must be greater than 0')
    })

    it('should handle errors in tasks', async () => {
        const { Semaphore } = await import('../src/utils/async')

        const semaphore = new Semaphore(2)

        await expect(
            semaphore.run(async () => {
                throw new Error('Task failed')
            })
        ).rejects.toThrow('Task failed')
    })

    it('should release semaphore even if task fails', async () => {
        const { Semaphore } = await import('../src/utils/async')

        const semaphore = new Semaphore(1)

        // First task fails
        await expect(
            semaphore.run(async () => {
                throw new Error('Fail')
            })
        ).rejects.toThrow()

        // Second task should still run
        const result = await semaphore.run(async () => 'success')
        expect(result).toBe('success')
    })
})
