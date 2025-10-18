/**
 * SDK Core Tests
 *
 * Tests for main IMessageSDK class
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { IMessageDatabase } from '../src/core/database'
import { IMessageSDK } from '../src/core/sdk'
import { MessageSender } from '../src/core/sender'
import { PluginManager } from '../src/plugins/core'
import { createMockDatabase, createSpy, insertTestMessage } from './setup'

// Import real asRecipient before mocking
import { asRecipient as realAsRecipient } from '../src/types/advanced'

// Mock platform check to run tests on any OS
mock.module('../src/utils/platform', () => ({
    requireMacOS: () => {},
    isMacOS: () => true,
    getDefaultDatabasePath: () => '/mock/path/chat.db',
    asRecipient: realAsRecipient, // Use real implementation
}))

describe('IMessageSDK', () => {
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

    describe('Constructor', () => {
        it('should initialize with default config', () => {
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

            expect(sdk).toBeInstanceOf(IMessageSDK)
        })

        it('should accept custom configuration', () => {
            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    debug: true,
                    maxConcurrent: 10,
                    scriptTimeout: 60000,
                },
                {
                    database,
                    sender,
                    pluginManager,
                }
            )

            expect(sdk).toBeInstanceOf(IMessageSDK)
        })

        it('should register plugins from config', async () => {
            const initSpy = createSpy<() => void>()
            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    plugins: [
                        {
                            name: 'test-plugin',
                            onInit: initSpy.fn,
                        },
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

            expect(initSpy.callCount()).toBeGreaterThan(0)
        })
    })

    describe('use', () => {
        it('should register plugin after initialization', async () => {
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

            const initSpy = createSpy<() => void>()
            sdk.use({
                name: 'late-plugin',
                onInit: initSpy.fn,
            })

            expect(initSpy.callCount()).toBe(0) // Not initialized yet
        })

        it('should support method chaining', async () => {
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

            expect(result.messages.length).toBe(1)
            expect(result.messages[0]?.text).toBe('Test message')
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

            expect(result.messages.length).toBe(1)
            expect(result.messages[0]?.text).toBe('Unread')
        })
    })

    describe('getUnreadMessages', () => {
        it('should return grouped unread messages', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Message 1',
                sender: '+1111111111',
                isRead: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'Message 2',
                sender: '+1111111111',
                isRead: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'Message 3',
                sender: '+2222222222',
                isRead: false,
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

            const grouped = await sdk.getUnreadMessages()

            expect(grouped.length).toBe(2)
            expect(grouped.find((g) => g.sender === '+1111111111')?.messages.length).toBe(2)
            expect(grouped.find((g) => g.sender === '+2222222222')?.messages.length).toBe(1)
        })
    })

    describe('message', () => {
        it('should create message chain', async () => {
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

            const mockMessage: any = {
                id: '1',
                text: 'Hello',
                sender: '+1234567890',
                isFromMe: false,
            }

            const chain = sdk.message(mockMessage)

            expect(chain).toBeDefined()
            expect(typeof chain.ifFromOthers).toBe('function')
            expect(typeof chain.matchText).toBe('function')
            expect(typeof chain.replyText).toBe('function')
        })
    })

    describe('close', () => {
        it('should close SDK and release resources', async () => {
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

            await sdk.close()
            // Should complete without errors
        })

        it('should call plugin onDestroy hooks', async () => {
            const destroySpy = createSpy<() => void>()
            const database = new IMessageDatabase(mockDb.path)
            const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
            const pluginManager = new PluginManager()

            sdk = new IMessageSDK(
                {
                    plugins: [
                        {
                            name: 'test',
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

            await sdk.close()

            expect(destroySpy.callCount()).toBe(1)
        })

        it('should allow multiple close calls', async () => {
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

            await sdk.close()
            await sdk.close() // Should not throw
        })

        it('should throw error when using SDK after close', async () => {
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

            await sdk.close()

            await expect(sdk.getMessages()).rejects.toThrow('SDK is destroyed')
        })
    })

    describe('Symbol.dispose', () => {
        it('should support using declaration', async () => {
            const destroySpy = createSpy<() => void>()

            {
                const database = new IMessageDatabase(mockDb.path)
                const sender = new MessageSender(false, { max: 2, delay: 1000 }, 5, 30000)
                const pluginManager = new PluginManager()

                await using localSdk = new IMessageSDK(
                    {
                        plugins: [
                            {
                                name: 'test',
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

                // Use SDK
                await localSdk.getMessages()
            }

            // SDK should be automatically cleaned up
            await new Promise((resolve) => setTimeout(resolve, 100))
            expect(destroySpy.callCount()).toBeGreaterThan(0)
        })
    })
})
