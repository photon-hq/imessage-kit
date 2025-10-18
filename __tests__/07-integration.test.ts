/**
 * Integration Tests
 *
 * End-to-end tests that test multiple components together
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { IMessageDatabase } from '../src/core/database'
import { IMessageSDK } from '../src/core/sdk'
import { MessageSender } from '../src/core/sender'
import { PluginManager } from '../src/plugins/core'
import { loggerPlugin } from '../src/plugins/logger'
import { createMockDatabase, createSpy, insertTestMessage } from './setup'

// Import real asRecipient before mocking
import { asRecipient as realAsRecipient } from '../src/types/advanced'

// Mock platform check
mock.module('../src/utils/platform', () => ({
    requireMacOS: () => {},
    isMacOS: () => true,
    getDefaultDatabasePath: () => '/mock/path/chat.db',
    asRecipient: realAsRecipient, // Use real implementation
}))

describe('Integration Tests', () => {
    let mockDb: { db: Database; path: string; cleanup: () => void }
    let sdk: IMessageSDK

    beforeEach(() => {
        mockDb = createMockDatabase()
    })

    afterEach(async () => {
        if (sdk) {
            await sdk.close()
        }
        mockDb.cleanup()
    })

    describe('Query and Chain Processing', () => {
        it('should query messages and process with chains', async () => {
            // Insert test messages
            insertTestMessage(mockDb.db, {
                text: 'hello',
                sender: '+1111111111',
                isRead: false,
                isFromMe: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'world',
                sender: '+2222222222',
                isRead: false,
                isFromMe: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'from me',
                sender: 'me@example.com',
                isRead: true,
                isFromMe: true,
            })

            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {},
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            const result = await sdk.getMessages({ unreadOnly: true })

            let processedCount = 0
            for (const message of result.messages) {
                await sdk
                    .message(message)
                    .ifFromOthers()
                    .ifUnread()
                    .do(() => {
                        processedCount++
                    })
                    .execute()
            }

            expect(processedCount).toBe(2) // Only unread messages from others
        })

        it('should handle text matching in chains', async () => {
            insertTestMessage(mockDb.db, {
                text: '/help',
                sender: '+1234567890',
                isRead: false,
                isFromMe: false,
            })
            insertTestMessage(mockDb.db, {
                text: '/start',
                sender: '+0987654321',
                isRead: false,
                isFromMe: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'random message',
                sender: '+1111111111',
                isRead: false,
                isFromMe: false,
            })

            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {},
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            const result = await sdk.getMessages()

            let helpCount = 0
            let startCount = 0

            for (const message of result.messages) {
                await sdk
                    .message(message)
                    .ifFromOthers()
                    .matchText(/^\/help$/i)
                    .do(() => {
                        helpCount++
                    })
                    .execute()

                await sdk
                    .message(message)
                    .ifFromOthers()
                    .matchText(/^\/start$/i)
                    .do(() => {
                        startCount++
                    })
                    .execute()
            }

            expect(helpCount).toBe(1)
            expect(startCount).toBe(1)
        })
    })

    describe('Plugin Integration', () => {
        it('should trigger plugin hooks during operations', async () => {
            const initSpy = createSpy<() => void>()
            const beforeQuerySpy = createSpy<() => void>()
            const afterQuerySpy = createSpy<() => void>()
            const destroySpy = createSpy<() => void>()

            insertTestMessage(mockDb.db, {
                text: 'Test',
                sender: '+1234567890',
            })

            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    plugins: [
                        {
                            name: 'test-plugin',
                            onInit: initSpy.fn,
                            onBeforeQuery: beforeQuerySpy.fn,
                            onAfterQuery: afterQuerySpy.fn,
                            onDestroy: destroySpy.fn,
                        },
                    ],
                },
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            // Trigger query
            await sdk.getMessages()

            // Close SDK
            await sdk.close()

            expect(initSpy.callCount()).toBeGreaterThan(0)
            expect(beforeQuerySpy.callCount()).toBe(1)
            expect(afterQuerySpy.callCount()).toBe(1)
            expect(destroySpy.callCount()).toBe(1)
        })

        it('should work with logger plugin', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Test message',
                sender: '+1234567890',
            })

            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    plugins: [
                        loggerPlugin({
                            level: 'info',
                            colored: false,
                            timestamp: false,
                        }),
                    ],
                    debug: true,
                },
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            // Should not throw
            await expect(sdk.getMessages()).resolves.toBeDefined()
            await sdk.close()
        })
    })

    describe('Multiple Plugins', () => {
        it('should support multiple plugins', async () => {
            const plugin1Spy = createSpy<() => void>()
            const plugin2Spy = createSpy<() => void>()
            const plugin3Spy = createSpy<() => void>()

            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    plugins: [
                        { name: 'plugin1', onInit: plugin1Spy.fn },
                        { name: 'plugin2', onInit: plugin2Spy.fn },
                        { name: 'plugin3', onInit: plugin3Spy.fn },
                    ],
                },
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            // Trigger plugin initialization
            await sdk.getMessages()

            expect(plugin1Spy.callCount()).toBe(1)
            expect(plugin2Spy.callCount()).toBe(1)
            expect(plugin3Spy.callCount()).toBe(1)
        })

        it('should handle plugin errors gracefully', async () => {
            const workingPluginSpy = createSpy<() => void>()

            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    plugins: [
                        {
                            name: 'failing-plugin',
                            onBeforeQuery: () => {
                                throw new Error('Plugin error')
                            },
                        },
                        {
                            name: 'working-plugin',
                            onBeforeQuery: workingPluginSpy.fn,
                        },
                    ],
                },
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            // Should still work despite plugin error
            await expect(sdk.getMessages()).resolves.toBeDefined()
            expect(workingPluginSpy.callCount()).toBe(1)
        })
    })

    describe('Complex Workflows', () => {
        it('should handle auto-reply bot workflow', async () => {
            insertTestMessage(mockDb.db, {
                text: '/help',
                sender: '+1234567890',
                isRead: false,
                isFromMe: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'hello',
                sender: '+0987654321',
                isRead: false,
                isFromMe: false,
            })

            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {},
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            const result = await sdk.getMessages({ unreadOnly: true })

            const replies: Array<{ to: string; text: string }> = []

            for (const message of result.messages) {
                // Handle /help command
                await sdk
                    .message(message)
                    .ifFromOthers()
                    .matchText(/^\/help$/i)
                    .do(() => {
                        replies.push({
                            to: message.sender,
                            text: 'Help: Available commands...',
                        })
                    })
                    .execute()

                // Handle greeting
                await sdk
                    .message(message)
                    .ifFromOthers()
                    .matchText(/^hello$/i)
                    .do(() => {
                        replies.push({
                            to: message.sender,
                            text: `Hi ${message.sender}!`,
                        })
                    })
                    .execute()
            }

            expect(replies.length).toBe(2)
            expect(replies.find((r) => r.text.includes('Help'))).toBeDefined()
            expect(replies.find((r) => r.text.includes('Hi'))).toBeDefined()
        })
    })

    describe('Error Recovery', () => {
        it('should recover from plugin errors', async () => {
            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    plugins: [
                        {
                            name: 'error-plugin',
                            onInit: () => {
                                throw new Error('Init error')
                            },
                        },
                    ],
                },
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            // SDK should still work
            await expect(sdk.getMessages()).resolves.toBeDefined()
        })
    })
})
