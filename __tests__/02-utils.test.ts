/**
 * Utility Functions Tests
 *
 * Tests for all utility functions and helpers
 */

import { describe, expect, it } from 'bun:test'
import { LIMITS } from '../src/config'
import { IMessageError } from '../src/domain/errors'

describe('Platform Utils', () => {
    describe('validateRecipient', () => {
        it('should validate phone numbers', async () => {
            const { validateRecipient } = await import('../src/domain/validate')

            expect(validateRecipient('+1234567890')).toBe('+1234567890')
            expect(validateRecipient('+1 (234) 567-8900')).toBe('+1 (234) 567-8900')
            expect(validateRecipient('1234567890')).toBe('1234567890')
        })

        it('should validate email addresses', async () => {
            const { validateRecipient } = await import('../src/domain/validate')

            expect(validateRecipient('user@example.com')).toBe('user@example.com')
            expect(validateRecipient('test.user+tag@example.co.uk')).toBe('test.user+tag@example.co.uk')
        })

        it('should throw error for invalid recipients', async () => {
            const { validateRecipient } = await import('../src/domain/validate')

            expect(() => validateRecipient('')).toThrow('Recipient cannot be empty')
            expect(() => validateRecipient('   ')).toThrow('Invalid recipient format')
            expect(() => validateRecipient('invalid')).toThrow('Invalid recipient format')
            expect(() => validateRecipient('@invalid')).toThrow('Invalid recipient format')
            expect(() => validateRecipient('invalid')).toThrow(IMessageError)
        })

        it('should reject recipient strings over max length', async () => {
            const { validateRecipient } = await import('../src/domain/validate')

            const tooLong = 'a'.repeat(LIMITS.maxRecipientLength + 1)
            expect(() => validateRecipient(tooLong)).toThrow(/Recipient exceeds maximum length/)
            expect(() => validateRecipient(tooLong)).toThrow(IMessageError)
        })

        it('should reject whitespace-padded recipients (no trimming)', async () => {
            const { validateRecipient } = await import('../src/domain/validate')

            // The new validate does not trim — whitespace-padded strings are invalid
            expect(() => validateRecipient('  user@example.com  ')).toThrow('Invalid recipient format')
            expect(() => validateRecipient('\n+1234567890\t')).toThrow('Invalid recipient format')
        })
    })

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
        it('should treat attempts below 1 as a single attempt', async () => {
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
    })

    describe('validateMessageContent', () => {
        it('should accept text only', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            const result = validateMessageContent('Hello', undefined)
            expect(result.hasText).toBe(true)
            expect(result.hasAttachments).toBe(false)
        })

        it('should accept attachments only', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            const result = validateMessageContent(undefined, ['/path/to/file.jpg'])
            expect(result.hasText).toBe(false)
            expect(result.hasAttachments).toBe(true)
        })

        it('should accept both text and attachments', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            const result = validateMessageContent('Hello', ['/path/to/file.jpg'])
            expect(result.hasText).toBe(true)
            expect(result.hasAttachments).toBe(true)
        })

        it('should reject empty content', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            expect(() => validateMessageContent(undefined, undefined)).toThrow(
                'Message must have text or at least one attachment'
            )
            expect(() => validateMessageContent('', [])).toThrow('Message must have text or at least one attachment')
        })

        it('should handle whitespace-only text as having no text', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            // The new validateMessageContent checks `text !== ''` but does not trim.
            // Whitespace-only text is considered valid text content.
            const result = validateMessageContent('   ', undefined)
            expect(result.hasText).toBe(true)
            expect(result.hasAttachments).toBe(false)
        })

        it('should reject text exceeding max length', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            const longText = 'x'.repeat(LIMITS.maxTextLength + 1)
            expect(() => validateMessageContent(longText, undefined)).toThrow('exceeds maximum length')
        })

        it('should reject attachments exceeding max count', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            const paths = Array.from({ length: LIMITS.maxAttachmentsPerMessage + 1 }, (_, i) => `/f${i}`)
            expect(() => validateMessageContent(undefined, paths)).toThrow('Too many attachments')
        })

        it('should accept attachments at the limit', async () => {
            const { validateMessageContent } = await import('../src/domain/validate')

            const paths = Array.from({ length: LIMITS.maxAttachmentsPerMessage }, (_, i) => `/f${i}`)
            const result = validateMessageContent(undefined, paths)
            expect(result.hasAttachments).toBe(true)
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
