/**
 * Utility Functions Tests
 *
 * Tests for all utility functions and helpers
 */

import { beforeEach, describe, expect, it } from 'bun:test'

describe('Platform Utils', () => {
    describe('asRecipient', () => {
        // We'll need to dynamically import to avoid platform check during module load
        it('should validate phone numbers', async () => {
            const { asRecipient } = await import('../src/types/advanced')

            expect(asRecipient('+1234567890')).toBe('+1234567890')
            expect(asRecipient('+1 (234) 567-8900')).toBe('+1 (234) 567-8900')
            expect(asRecipient('1234567890')).toBe('1234567890')
        })

        it('should validate email addresses', async () => {
            const { asRecipient } = await import('../src/types/advanced')

            expect(asRecipient('user@example.com')).toBe('user@example.com')
            expect(asRecipient('test.user+tag@example.co.uk')).toBe('test.user+tag@example.co.uk')
        })

        it('should throw error for invalid recipients', async () => {
            const { asRecipient } = await import('../src/types/advanced')

            expect(() => asRecipient('')).toThrow('Recipient cannot be empty')
            expect(() => asRecipient('   ')).toThrow('Recipient cannot be empty')
            expect(() => asRecipient('invalid')).toThrow('Invalid recipient format')
            expect(() => asRecipient('@invalid')).toThrow('Invalid recipient format')
        })

        it('should trim whitespace', async () => {
            const { asRecipient } = await import('../src/types/advanced')

            expect(asRecipient('  user@example.com  ')).toBe('user@example.com')
            expect(asRecipient('\n+1234567890\t')).toBe('+1234567890')
        })
    })

    describe('isURL', () => {
        it('should validate HTTP(S) URLs', async () => {
            const { isURL } = await import('../src/types/advanced')

            expect(isURL('https://example.com')).toBe(true)
            expect(isURL('http://example.com')).toBe(true)
            expect(isURL('https://example.com/path?query=value')).toBe(true)
        })

        it('should reject invalid URLs', async () => {
            const { isURL } = await import('../src/types/advanced')

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
            const { delay } = await import('../src/utils/common')

            const start = Date.now()
            await delay(100)
            const elapsed = Date.now() - start

            expect(elapsed).toBeGreaterThanOrEqual(95) // Allow small margin
            expect(elapsed).toBeLessThan(150)
        })

        it('should handle zero delay', async () => {
            const { delay } = await import('../src/utils/common')

            const start = Date.now()
            await delay(0)
            const elapsed = Date.now() - start

            expect(elapsed).toBeLessThan(50)
        })
    })

    describe('validateMessageContent', () => {
        it('should accept text only', async () => {
            const { validateMessageContent } = await import('../src/utils/common')

            const result = validateMessageContent('Hello', undefined)
            expect(result.hasText).toBe(true)
            expect(result.hasAttachments).toBe(false)
        })

        it('should accept attachments only', async () => {
            const { validateMessageContent } = await import('../src/utils/common')

            const result = validateMessageContent(undefined, ['/path/to/file.jpg'])
            expect(result.hasText).toBe(false)
            expect(result.hasAttachments).toBe(true)
        })

        it('should accept both text and attachments', async () => {
            const { validateMessageContent } = await import('../src/utils/common')

            const result = validateMessageContent('Hello', ['/path/to/file.jpg'])
            expect(result.hasText).toBe(true)
            expect(result.hasAttachments).toBe(true)
        })

        it('should reject empty content', async () => {
            const { validateMessageContent } = await import('../src/utils/common')

            expect(() => validateMessageContent(undefined, undefined)).toThrow(
                'Message must contain text or attachments'
            )
            expect(() => validateMessageContent('', [])).toThrow('Message must contain text or attachments')
            expect(() => validateMessageContent('   ', [])).toThrow('Message must contain text or attachments')
        })

        it('should handle whitespace-only text', async () => {
            const { validateMessageContent } = await import('../src/utils/common')

            expect(() => validateMessageContent('   ', undefined)).toThrow('Message must contain text or attachments')
        })
    })
})

describe('Semaphore', () => {
    it('should limit concurrency', async () => {
        const { Semaphore } = await import('../src/utils/semaphore')

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
        const { Semaphore } = await import('../src/utils/semaphore')

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
        const { Semaphore } = await import('../src/utils/semaphore')

        expect(() => new Semaphore(0)).toThrow('Concurrency limit must be greater than 0')
        expect(() => new Semaphore(-1)).toThrow('Concurrency limit must be greater than 0')
    })

    it('should handle errors in tasks', async () => {
        const { Semaphore } = await import('../src/utils/semaphore')

        const semaphore = new Semaphore(2)

        await expect(
            semaphore.run(async () => {
                throw new Error('Task failed')
            })
        ).rejects.toThrow('Task failed')
    })

    it('should release semaphore even if task fails', async () => {
        const { Semaphore } = await import('../src/utils/semaphore')

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
