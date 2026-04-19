/**
 * SDK Core Tests
 *
 * Tests for main IMessageSDK class
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { MessageSender } from '../src/infra/outgoing/sender'
import { IMessageSDK } from '../src/sdk'
import { createMockDatabase, createSpy, insertTestMessage } from './setup'

// Mock platform check to run tests on any OS
mock.module('../src/infra/platform', () => ({
    requireMacOS: () => {},
    getDefaultDatabasePath: () => '/mock/path/chat.db',
    getDarwinMajorVersion: () => 24,
}))

describe('IMessageSDK', () => {
    let mockDb: { db: Database; path: string; cleanup: () => void }
    let sdk!: IMessageSDK

    const createSdk = (config: ConstructorParameters<typeof IMessageSDK>[0] = {}) =>
        new IMessageSDK({ databasePath: mockDb.path, ...config })

    const withMockedSend = async (impl: (options: any) => Promise<any>, run: () => Promise<void>) => {
        const previousSend = MessageSender.prototype.send
        ;(MessageSender.prototype.send as any) = impl

        try {
            await run()
        } finally {
            MessageSender.prototype.send = previousSend
        }
    }

    beforeEach(() => {
        mockDb = createMockDatabase()
    })

    afterEach(async () => {
        if (sdk) {
            await sdk.close()
        }

        mockDb.cleanup()
    })

    describe('Constructor', () => {
        it('should initialize with default config', () => {
            sdk = createSdk()

            expect(sdk).toBeInstanceOf(IMessageSDK)
        })

        it('should accept custom configuration', () => {
            sdk = createSdk({
                debug: true,
                maxConcurrentSends: 10,
            })

            expect(sdk).toBeInstanceOf(IMessageSDK)
        })

        it('should register plugins from config', async () => {
            const initSpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'test-plugin',
                        onInit: initSpy.fn,
                    },
                ],
            })

            // Trigger plugin initialization
            await sdk.getMessages()

            expect(initSpy.callCount()).toBeGreaterThan(0)
        })
    })

    describe('use', () => {
        it('should register plugin after initialization', async () => {
            sdk = createSdk()

            const initSpy = createSpy<() => void>()
            sdk.use({
                name: 'late-plugin',
                onInit: initSpy.fn,
            })

            expect(initSpy.callCount()).toBe(0) // Not initialized yet
        })

        it('should support method chaining', async () => {
            sdk = createSdk()

            const result = sdk.use({ name: 'plugin1' }).use({ name: 'plugin2' })

            expect(result).toBe(sdk)
        })
    })

    describe('getMessages', () => {
        it('should query messages from database', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Test message',
                sender: '+1234567890',
            })

            sdk = createSdk()

            const messages = await sdk.getMessages()

            expect(messages.length).toBe(1)
            expect(messages[0]?.text).toBe('Test message')
        })

        it('should support filters', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Unread',
                sender: '+1111111111',
                isRead: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'Read',
                sender: '+2222222222',
                isRead: true,
            })

            sdk = createSdk()

            const messages = await sdk.getMessages({ isRead: false })

            expect(messages.length).toBe(1)
            expect(messages[0]?.text).toBe('Unread')
        })
    })

    describe('startWatching', () => {
        it('should initialize plugins before starting watcher flow', async () => {
            const initSpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'watch-plugin',
                        onInit: initSpy.fn,
                    },
                ],
            })

            await sdk.startWatching()

            expect(initSpy.callCount()).toBeGreaterThan(0)

            await sdk.stopWatching()
        })

        it('stopWatching is a no-op when the watcher was never started', async () => {
            sdk = createSdk()
            // Must resolve without error even though start() was never called.
            await expect(sdk.stopWatching()).resolves.toBeUndefined()
        })

        it('should reject a concurrent startWatching call instead of orphaning the first watcher', async () => {
            sdk = createSdk()

            // Two concurrent calls in the same tick — the slot is claimed
            // synchronously, so the second call must throw rather than
            // silently building a parallel watcher that would leak.
            const first = sdk.startWatching()
            const second = sdk.startWatching()

            await expect(second).rejects.toThrow('Watcher is already running')
            await first

            await sdk.stopWatching()
        })
    })

    describe('close', () => {
        it('should close SDK and release resources', async () => {
            sdk = createSdk()

            await sdk.close()
            // Should complete without errors
        })

        it('should call plugin onDestroy hooks', async () => {
            const destroySpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'test',
                        onDestroy: destroySpy.fn,
                    },
                ],
            })

            await sdk.close()

            expect(destroySpy.callCount()).toBe(1)
        })

        it('should allow multiple close calls', async () => {
            sdk = createSdk()

            await sdk.close()
            await sdk.close() // Should not throw
        })

        it('should make concurrent close calls await the same in-flight shutdown', async () => {
            let destroyEntered!: () => void
            const destroyEnteredPromise = new Promise<void>((resolve) => {
                destroyEntered = resolve
            })
            let releaseDestroy!: () => void
            const destroyGate = new Promise<void>((resolve) => {
                releaseDestroy = resolve
            })
            let destroyCalls = 0
            let secondResolved = false

            sdk = createSdk({
                plugins: [
                    {
                        name: 'slow-destroy',
                        onDestroy: async () => {
                            destroyCalls++
                            destroyEntered()
                            await destroyGate
                        },
                    },
                ],
            })

            await sdk.getMessages() // Force plugin init so onDestroy runs

            const first = sdk.close()
            const second = sdk.close().then(() => {
                secondResolved = true
            })

            // Wait until the in-flight onDestroy has actually started.
            await destroyEnteredPromise

            // Exactly one invocation — the second close must not skip ahead
            // on a synchronous `destroyed` flag while the first is still
            // mid-teardown.
            expect(destroyCalls).toBe(1)
            // And the second close must still be pending — it's sharing
            // the first call's promise, not resolving independently.
            expect(secondResolved).toBe(false)

            releaseDestroy()
            await Promise.all([first, second])

            expect(destroyCalls).toBe(1)
            expect(secondResolved).toBe(true)
        })

        it('should throw error when using SDK after close', async () => {
            sdk = createSdk()

            await sdk.close()

            await expect(sdk.getMessages()).rejects.toThrow('SDK is destroyed')
        })
    })

    describe('Symbol.dispose', () => {
        it('should support using declaration', async () => {
            const destroySpy = createSpy<() => void>()

            {
                await using localSdk = createSdk({
                    plugins: [
                        {
                            name: 'test',
                            onDestroy: destroySpy.fn,
                        },
                    ],
                })

                // Use SDK
                await localSdk.getMessages()
            }

            // SDK should be automatically cleaned up
            await new Promise((resolve) => setTimeout(resolve, 100))
            expect(destroySpy.callCount()).toBeGreaterThan(0)
        })
    })

    describe('File Sending API', () => {
        it('should accept files parameter in send()', async () => {
            const sendSpy = createSpy<(options: any) => Promise<{ status: 'sent'; sentAt: Date }>>(() =>
                Promise.resolve({ status: 'sent', sentAt: new Date() })
            )

            await withMockedSend(sendSpy.fn, async () => {
                sdk = createSdk()

                await sdk.send({
                    to: '+1234567890',
                    attachments: ['/path/to/file.pdf', '/path/to/contact.vcf'],
                })
            })

            expect(sendSpy.callCount()).toBe(1)
            const callArgs = sendSpy.getCalls()[0]
            expect(callArgs.attachments).toEqual(['/path/to/file.pdf', '/path/to/contact.vcf'])
        })

        it('should send text with attachments', async () => {
            const sendSpy = createSpy<(options: any) => Promise<{ status: 'sent'; sentAt: Date }>>(() =>
                Promise.resolve({ status: 'sent', sentAt: new Date() })
            )

            await withMockedSend(sendSpy.fn, async () => {
                sdk = createSdk()

                await sdk.send({
                    to: '+1234567890',
                    text: 'Check these',
                    attachments: ['/image.jpg', '/document.pdf'],
                })
            })

            expect(sendSpy.callCount()).toBe(1)
            const callArgs = sendSpy.getCalls()[0]
            expect(callArgs.attachments).toEqual(['/image.jpg', '/document.pdf'])
            expect(callArgs.text).toBe('Check these')
        })
    })
})
