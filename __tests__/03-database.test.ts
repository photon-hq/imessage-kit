/**
 * Database Tests
 *
 * Tests for MessagesDatabaseReader class
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { MessagesDatabaseReader } from '../src/infra/db/reader'
import { createMockDatabase, insertTestMessage } from './setup'

describe('MessagesDatabaseReader', () => {
    let mockDb: { db: Database; path: string; cleanup: () => void }
    let database: MessagesDatabaseReader

    beforeEach(() => {
        mockDb = createMockDatabase()
        database = new MessagesDatabaseReader(mockDb.path)
    })

    afterEach(() => {
        database.close()
        mockDb.cleanup()
    })

    describe('Constructor', () => {
        it('should open database successfully', () => {
            expect(database).toBeInstanceOf(MessagesDatabaseReader)
        })

        it('should throw DatabaseError for invalid path', () => {
            expect(() => new MessagesDatabaseReader('/non/existent/path.db')).toThrow(/Failed to open database/)
        })
    })

    describe('getMessages', () => {
        const baseDate = Date.now()

        beforeEach(() => {
            // Insert test messages with distinct dates for deterministic ORDER BY
            insertTestMessage(mockDb.db, {
                text: 'Hello',
                sender: '+1234567890',
                isRead: false,
                isFromMe: false,
                date: baseDate - 2000,
            })
            insertTestMessage(mockDb.db, {
                text: 'World',
                sender: '+0987654321',
                isRead: true,
                isFromMe: false,
                date: baseDate - 1000,
            })
            insertTestMessage(mockDb.db, {
                text: 'From me',
                sender: 'me@example.com',
                isRead: true,
                isFromMe: true,
                date: baseDate,
            })
        })

        it('should query all messages (including own by default)', async () => {
            const messages = await database.getMessages()

            expect(messages.length).toBe(3)
            expect(messages.some((m) => m.isFromMe)).toBe(true)
        })

        it('should filter to only others messages with isFromMe: false', async () => {
            const messages = await database.getMessages({ isFromMe: false })

            expect(messages.length).toBe(2)
            expect(messages.every((m) => !m.isFromMe)).toBe(true)
        })

        it('should filter to only own messages with isFromMe: true', async () => {
            const messages = await database.getMessages({ isFromMe: true })

            expect(messages.length).toBe(1)
            expect(messages.every((m) => m.isFromMe)).toBe(true)
        })

        it('should filter unread messages', async () => {
            const messages = await database.getMessages({ isRead: false })

            expect(messages.length).toBe(1)
            expect(messages[0]?.isRead).toBe(false)
        })

        it('should filter by participant', async () => {
            const messages = await database.getMessages({ participant: '+1234567890' })

            expect(messages.length).toBe(1)
            expect(messages[0]?.participant).toBe('+1234567890')
            expect(messages[0]?.text).toBe('Hello')
        })

        it('should limit results', async () => {
            const messages = await database.getMessages({ limit: 2 })

            expect(messages.length).toBe(2)
        })

        it('should support offset without requiring an explicit limit', async () => {
            const messages = await database.getMessages({ offset: 1 })

            expect(messages.length).toBe(2)
            expect(messages[0]?.text).toBe('World')
            expect(messages[1]?.text).toBe('Hello')
        })

        it('should apply search before limit truncation', async () => {
            mockDb.cleanup()
            mockDb = createMockDatabase()
            database = new MessagesDatabaseReader(mockDb.path)

            const now = Date.now()

            insertTestMessage(mockDb.db, {
                text: 'match-old',
                sender: '+1234567890',
                date: now - 3000,
            })
            insertTestMessage(mockDb.db, {
                text: 'noise-new-1',
                sender: '+1234567890',
                date: now - 2000,
            })
            insertTestMessage(mockDb.db, {
                text: 'noise-new-2',
                sender: '+1234567890',
                date: now - 1000,
            })

            const messages = await database.getMessages({ search: 'match', limit: 2 })

            expect(messages).toHaveLength(1)
            expect(messages[0]?.text).toBe('match-old')
        })

        it('should recover chatId from ck_chat_id when chat join is missing', async () => {
            const messageId = insertTestMessage(mockDb.db, {
                text: 'Recovered from ck_chat_id',
                sender: '+1234567890',
                service: 'iMessage',
            })

            mockDb.db.prepare('DELETE FROM chat_message_join WHERE message_id = ?').run(messageId)
            mockDb.db.prepare('UPDATE message SET ck_chat_id = ? WHERE ROWID = ?').run('any;-;+1234567890', messageId)

            const message = (await database.getMessages()).find((item) => item.rowId === messageId)

            expect(message?.chatId).toBe('any;-;+1234567890')
            expect(message?.chatKind).toBe('dm')
        })

        it('should recover chatId from destination_caller_id when chat and handle are missing', async () => {
            const MAC_EPOCH = new Date('2001-01-01T00:00:00Z').getTime()
            const macTimestamp = (Date.now() - MAC_EPOCH) * 1_000_000

            mockDb.db
                .prepare(
                    `
                        INSERT INTO message (
                            guid,
                            text,
                            service,
                            date,
                            is_from_me,
                            is_sent,
                            destination_caller_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    `
                )
                .run('orphan-message-guid', 'Recovered from destination', 'SMS', macTimestamp, 1, 1, '+8618722049982')

            const row = mockDb.db.query('SELECT last_insert_rowid() as id').get() as { id: number }
            const message = (await database.getMessages({ isFromMe: true })).find((item) => item.rowId === row.id)

            expect(message?.chatId).toBe('SMS;-;+8618722049982')
            expect(message?.chatKind).toBe('dm')
        })

        it('should filter by service type', async () => {
            insertTestMessage(mockDb.db, {
                text: 'SMS message',
                sender: '+1111111111',
                service: 'SMS',
            })

            const messages = await database.getMessages({ service: 'SMS' })

            expect(messages.length).toBe(1)
            expect(messages[0]?.service).toBe('SMS')
        })

        it('should filter by date', async () => {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
            const messages = await database.getMessages({ since: yesterday })

            expect(messages.length).toBeGreaterThan(0)
        })

        it('should return message with correct structure', async () => {
            const messages = await database.getMessages({ limit: 1 })
            const message = messages[0]

            expect(message).toBeDefined()
            expect(typeof message?.rowId).toBe('number')
            expect(typeof message?.id).toBe('string')
            expect(typeof message?.participant).toBe('string')
            expect(typeof message?.isRead).toBe('boolean')
            expect(typeof message?.isFromMe).toBe('boolean')
            expect(typeof message?.chatKind).toBe('string')
            expect(message?.createdAt).toBeInstanceOf(Date)
            expect(Array.isArray(message?.attachments)).toBe(true)
        })

        it('should return empty result for no matches', async () => {
            const messages = await database.getMessages({ participant: 'nonexistent@example.com' })

            expect(messages.length).toBe(0)
        })
    })

    describe('getMessagesSinceRowId', () => {
        it('returns only rows with ROWID > sinceRowId, ordered ascending', async () => {
            const id1 = insertTestMessage(mockDb.db, { text: 'a', sender: '+1' })
            const id2 = insertTestMessage(mockDb.db, { text: 'b', sender: '+1' })
            const id3 = insertTestMessage(mockDb.db, { text: 'c', sender: '+1' })

            const since = await database.getMessagesSinceRowId(id1)
            expect(since.map((m) => m.rowId)).toEqual([id2, id3])
        })

        it('returns empty when sinceRowId is already the max', async () => {
            const maxId = insertTestMessage(mockDb.db, { text: 'x', sender: '+1' })
            const since = await database.getMessagesSinceRowId(maxId)
            expect(since).toHaveLength(0)
        })
    })

    describe('listChats', () => {
        it('returns the chats present in the database', async () => {
            // createMockDatabase seeds a handful of chats via insertTestMessage side effects.
            insertTestMessage(mockDb.db, { text: 'seed', sender: '+1234567890' })
            const chats = await database.listChats()
            expect(Array.isArray(chats)).toBe(true)
            // Each chat row must at minimum carry a chatId string.
            for (const c of chats) {
                expect(typeof c.chatId).toBe('string')
            }
        })

        it('respects the limit option', async () => {
            insertTestMessage(mockDb.db, { text: 'one', sender: '+1111111111' })
            insertTestMessage(mockDb.db, { text: 'two', sender: '+2222222222' })
            const chats = await database.listChats({ limit: 1 })
            expect(chats.length).toBeLessThanOrEqual(1)
        })
    })

    describe('Service Type Mapping', () => {
        // Narrow coverage the filter test doesn't give: the mapper must coerce unrecognised
        // service strings to `null` so downstream `service: 'iMessage' | 'SMS' | null` holds.
        it('maps unrecognized service values to null', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Unknown',
                sender: '+1234567890',
                service: 'unknown',
            })

            const messages = await database.getMessages()
            const unknown = messages.find((m) => m.text === 'Unknown')
            expect(unknown?.service).toBeNull()
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
