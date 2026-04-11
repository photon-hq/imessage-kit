/**
 * Integration Tests
 *
 * End-to-end tests that test multiple components together
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { loggerPlugin } from '../src/infra/plugin/logger'
import { IMessageSDK } from '../src/sdk'
import { createMockDatabase, createSpy, insertTestMessage } from './setup'

// Mock platform check
mock.module('../src/infra/platform', () => ({
    requireMacOS: () => {},
    getDefaultDatabasePath: () => '/mock/path/chat.db',
    getDarwinMajorVersion: () => 24,
}))

describe('Integration Tests', () => {
    let mockDb: { db: Database; path: string; cleanup: () => void }
    let sdk!: IMessageSDK

    const createSdk = (config: ConstructorParameters<typeof IMessageSDK>[0] = {}) =>
        new IMessageSDK({ databasePath: mockDb.path, ...config })

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

            sdk = createSdk()

            const messages = await sdk.getMessages({ unreadOnly: true })

            let processedCount = 0
            for (const message of messages) {
                await sdk
                    .message(message)
                    .ifUnread()
                    .do(() => {
                        processedCount++
                    })
                    .execute()
            }

            expect(processedCount).toBe(2) // Only unread messages
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

            sdk = createSdk()

            const messages = await sdk.getMessages()

            let helpCount = 0
            let startCount = 0

            for (const message of messages) {
                await sdk
                    .message(message)
                    .matchText(/^\/help$/i)
                    .do(() => {
                        helpCount++
                    })
                    .execute()

                await sdk
                    .message(message)
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

            sdk = createSdk({
                plugins: [
                    {
                        name: 'test-plugin',
                        onInit: initSpy.fn,
                        onBeforeMessageQuery: beforeQuerySpy.fn,
                        onAfterMessageQuery: afterQuerySpy.fn,
                        onDestroy: destroySpy.fn,
                    },
                ],
            })

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

            sdk = createSdk({
                plugins: [
                    loggerPlugin({
                        level: 'info',
                        colored: false,
                        timestamp: false,
                    }),
                ],
                debug: true,
            })

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

            sdk = createSdk({
                plugins: [
                    { name: 'plugin1', onInit: plugin1Spy.fn },
                    { name: 'plugin2', onInit: plugin2Spy.fn },
                    { name: 'plugin3', onInit: plugin3Spy.fn },
                ],
            })

            // Trigger plugin initialization
            await sdk.getMessages()

            expect(plugin1Spy.callCount()).toBe(1)
            expect(plugin2Spy.callCount()).toBe(1)
            expect(plugin3Spy.callCount()).toBe(1)
        })

        it('should handle plugin errors gracefully', async () => {
            const workingPluginSpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'failing-plugin',
                        onBeforeMessageQuery: () => {
                            throw new Error('Plugin error')
                        },
                    },
                    {
                        name: 'working-plugin',
                        onBeforeMessageQuery: workingPluginSpy.fn,
                    },
                ],
            })

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

            sdk = createSdk()

            const messages = await sdk.getMessages({ unreadOnly: true })

            const replies: Array<{ to: string; text: string }> = []

            for (const message of messages) {
                // Handle /help command
                await sdk
                    .message(message)
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
            sdk = createSdk({
                plugins: [
                    {
                        name: 'error-plugin',
                        onInit: () => {
                            throw new Error('Init error')
                        },
                    },
                ],
            })

            // SDK should still work
            await expect(sdk.getMessages()).resolves.toBeDefined()
        })
    })
})
