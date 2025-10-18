/**
 * Database Tests
 *
 * Tests for IMessageDatabase class
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { IMessageDatabase } from '../src/core/database'
import { DatabaseError } from '../src/core/errors'
import { createMockDatabase, insertTestMessage } from './setup'

describe('IMessageDatabase', () => {
    let mockDb: { db: Database; path: string; cleanup: () => void }
    let database: IMessageDatabase

    beforeEach(() => {
        mockDb = createMockDatabase()
        database = new IMessageDatabase(mockDb.path)
    })

    afterEach(() => {
        database.close()
        mockDb.cleanup()
    })

    describe('Constructor', () => {
        it('should open database successfully', () => {
            expect(database).toBeInstanceOf(IMessageDatabase)
        })

        it('should throw DatabaseError for invalid path', () => {
            expect(() => {
                new IMessageDatabase('/non/existent/path.db')
            }).toThrow()
        })
    })

    describe('getMessages', () => {
        beforeEach(() => {
            // Insert test messages
            insertTestMessage(mockDb.db, {
                text: 'Hello',
                sender: '+1234567890',
                isRead: false,
                isFromMe: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'World',
                sender: '+0987654321',
                isRead: true,
                isFromMe: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'From me',
                sender: 'me@example.com',
                isRead: true,
                isFromMe: true,
            })
        })

        it('should query all messages', async () => {
            const result = await database.getMessages()

            expect(result.messages.length).toBe(3)
            expect(result.total).toBe(3)
        })

        it('should filter unread messages', async () => {
            const result = await database.getMessages({ unreadOnly: true })

            expect(result.messages.length).toBe(1)
            expect(result.messages[0]?.isRead).toBe(false)
            expect(result.unreadCount).toBe(1)
        })

        it('should filter by sender', async () => {
            const result = await database.getMessages({ sender: '+1234567890' })

            expect(result.messages.length).toBe(1)
            expect(result.messages[0]?.sender).toBe('+1234567890')
            expect(result.messages[0]?.text).toBe('Hello')
        })

        it('should limit results', async () => {
            const result = await database.getMessages({ limit: 2 })

            expect(result.messages.length).toBe(2)
        })

        it('should filter by service type', async () => {
            insertTestMessage(mockDb.db, {
                text: 'SMS message',
                sender: '+1111111111',
                service: 'SMS',
            })

            const result = await database.getMessages({ service: 'SMS' })

            expect(result.messages.length).toBe(1)
            expect(result.messages[0]?.service).toBe('SMS')
        })

        it('should filter by date', async () => {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
            const result = await database.getMessages({ since: yesterday })

            expect(result.messages.length).toBeGreaterThan(0)
        })

        it('should return message with correct structure', async () => {
            const result = await database.getMessages({ limit: 1 })
            const message = result.messages[0]

            expect(message).toBeDefined()
            expect(typeof message?.id).toBe('string')
            expect(typeof message?.guid).toBe('string')
            expect(typeof message?.sender).toBe('string')
            expect(typeof message?.isRead).toBe('boolean')
            expect(typeof message?.isFromMe).toBe('boolean')
            expect(typeof message?.isGroupChat).toBe('boolean')
            expect(message?.date).toBeInstanceOf(Date)
            expect(Array.isArray(message?.attachments)).toBe(true)
        })

        it('should return empty result for no matches', async () => {
            const result = await database.getMessages({ sender: 'nonexistent@example.com' })

            expect(result.messages.length).toBe(0)
            expect(result.total).toBe(0)
            expect(result.unreadCount).toBe(0)
        })
    })

    describe('getUnreadMessages', () => {
        beforeEach(() => {
            insertTestMessage(mockDb.db, {
                text: 'Unread 1',
                sender: '+1111111111',
                isRead: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'Unread 2',
                sender: '+1111111111',
                isRead: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'Unread 3',
                sender: '+2222222222',
                isRead: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'Read',
                sender: '+3333333333',
                isRead: true,
            })
        })

        it('should group unread messages by sender', async () => {
            const grouped = await database.getUnreadMessages()

            expect(grouped.size).toBe(2)
            expect(grouped.get('+1111111111')?.length).toBe(2)
            expect(grouped.get('+2222222222')?.length).toBe(1)
            expect(grouped.has('+3333333333')).toBe(false)
        })

        it('should return empty map when no unread messages', async () => {
            // Mark all as read
            mockDb.db.prepare('UPDATE message SET is_read = 1').run()

            const grouped = await database.getUnreadMessages()

            expect(grouped.size).toBe(0)
        })
    })

    describe('Service Type Mapping', () => {
        it('should map iMessage service', async () => {
            insertTestMessage(mockDb.db, {
                text: 'iMessage',
                sender: '+1234567890',
                service: 'iMessage',
            })

            const result = await database.getMessages()
            expect(result.messages[0]?.service).toBe('iMessage')
        })

        it('should map SMS service', async () => {
            insertTestMessage(mockDb.db, {
                text: 'SMS',
                sender: '+1234567890',
                service: 'SMS',
            })

            const result = await database.getMessages()
            expect(result.messages[0]?.service).toBe('SMS')
        })

        it('should default to iMessage for unknown service', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Unknown',
                sender: '+1234567890',
                service: 'unknown',
            })

            const result = await database.getMessages()
            expect(result.messages[0]?.service).toBe('iMessage')
        })
    })

    describe('close', () => {
        it('should close database connection', () => {
            expect(() => database.close()).not.toThrow()
        })

        it('should allow multiple close calls', () => {
            database.close()
            expect(() => database.close()).not.toThrow()
        })
    })
})
