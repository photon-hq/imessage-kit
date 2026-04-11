/**
 * Reaction Detection Tests
 *
 * Tests for tapback reaction (love, like, dislike, laugh, emphasize, question,
 * emoji, sticker) detection and parsing in messages.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { MessagesDatabaseReader } from '../src/infra/db/reader'
import { createMockDatabase, insertTestMessage } from './setup'

// Mock platform
mock.module('../src/infra/platform', () => ({
    requireMacOS: () => {},
    getDefaultDatabasePath: () => '/tmp/mock-chat.db',
    getDarwinMajorVersion: () => 24,
}))

describe('Reaction Detection', () => {
    let dbPath: string
    let cleanup: () => void
    let originalMessageGuid: string

    beforeAll(() => {
        const { db, path, cleanup: c } = createMockDatabase()
        dbPath = path
        cleanup = c

        // Insert an original message to react to
        originalMessageGuid = 'original-message-guid-12345'
        insertTestMessage(db, {
            text: 'Hello, this is the original message',
            sender: '+1234567890',
            isRead: false,
        })

        // Insert reaction messages with different types
        // 2000 = love
        insertTestMessage(db, {
            text: 'Loved "Hello, this is the original message"',
            sender: '+1111111111',
            associatedMessageType: 2000,
            associatedMessageGuid: originalMessageGuid,
        })

        // 2001 = like
        insertTestMessage(db, {
            text: 'Liked "Hello, this is the original message"',
            sender: '+2222222222',
            associatedMessageType: 2001,
            associatedMessageGuid: originalMessageGuid,
        })

        // 2002 = dislike
        insertTestMessage(db, {
            text: 'Disliked "Hello, this is the original message"',
            sender: '+3333333333',
            associatedMessageType: 2002,
            associatedMessageGuid: originalMessageGuid,
        })

        // 2003 = laugh
        insertTestMessage(db, {
            text: 'Laughed at "Hello, this is the original message"',
            sender: '+4444444444',
            associatedMessageType: 2003,
            associatedMessageGuid: originalMessageGuid,
        })

        // 2004 = emphasize
        insertTestMessage(db, {
            text: 'Emphasized "Hello, this is the original message"',
            sender: '+5555555555',
            associatedMessageType: 2004,
            associatedMessageGuid: originalMessageGuid,
        })

        // 2005 = question
        insertTestMessage(db, {
            text: 'Questioned "Hello, this is the original message"',
            sender: '+6666666666',
            associatedMessageType: 2005,
            associatedMessageGuid: originalMessageGuid,
        })

        // 2006 = emoji tapback (iOS 17+ / macOS 14+)
        insertTestMessage(db, {
            text: '😍',
            sender: '+7777777777',
            associatedMessageType: 2006,
            associatedMessageGuid: originalMessageGuid,
            associatedMessageEmoji: '😍',
        })

        // 2007 = sticker tapback
        insertTestMessage(db, {
            text: null as any,
            sender: '+8888888888',
            associatedMessageType: 2007,
            associatedMessageGuid: originalMessageGuid,
        })

        // 3000 = remove love (reaction removal)
        insertTestMessage(db, {
            text: 'Removed a heart from "Hello"',
            sender: '+9999999999',
            associatedMessageType: 3000,
            associatedMessageGuid: originalMessageGuid,
        })

        // 3006 = remove emoji tapback
        insertTestMessage(db, {
            text: null as any,
            sender: '+7777777777',
            associatedMessageType: 3006,
            associatedMessageGuid: originalMessageGuid,
            associatedMessageEmoji: '😍',
        })

        // Ranged tapback (subset of target message body)
        insertTestMessage(db, {
            text: 'Ranged tapback row',
            sender: '+1010101010',
            associatedMessageType: 2000,
            associatedMessageGuid: originalMessageGuid,
            associatedMessageRangeLocation: 7,
            associatedMessageRangeLength: 5,
        })
    })

    afterAll(() => {
        cleanup()
    })

    it('should identify regular message as not a reaction', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const regularMessage = messages.find((m) => m.reaction === null)

        expect(regularMessage).toBeDefined()
        expect(regularMessage!.reaction).toBeNull()
    })

    it('should detect love reaction (2000)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const loveReaction = messages.find((m) => m.text?.includes('Loved'))

        expect(loveReaction).toBeDefined()
        expect(loveReaction!.reaction).not.toBeNull()
        expect(loveReaction!.reaction!.kind).toBe('love')
        expect(loveReaction!.reaction!.isRemoved).toBe(false)
        expect(loveReaction!.reaction!.targetMessageId).toBe(originalMessageGuid)
    })

    it('should detect like reaction (2001)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const likeReaction = messages.find((m) => m.text?.includes('Liked'))

        expect(likeReaction).toBeDefined()
        expect(likeReaction!.reaction).not.toBeNull()
        expect(likeReaction!.reaction!.kind).toBe('like')
    })

    it('should detect dislike reaction (2002)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const dislikeReaction = messages.find((m) => m.text?.includes('Disliked'))

        expect(dislikeReaction).toBeDefined()
        expect(dislikeReaction!.reaction).not.toBeNull()
        expect(dislikeReaction!.reaction!.kind).toBe('dislike')
    })

    it('should detect laugh reaction (2003)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const laughReaction = messages.find((m) => m.text?.includes('Laughed'))

        expect(laughReaction).toBeDefined()
        expect(laughReaction!.reaction).not.toBeNull()
        expect(laughReaction!.reaction!.kind).toBe('laugh')
    })

    it('should detect emphasize reaction (2004)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const emphasizeReaction = messages.find((m) => m.text?.includes('Emphasized'))

        expect(emphasizeReaction).toBeDefined()
        expect(emphasizeReaction!.reaction).not.toBeNull()
        expect(emphasizeReaction!.reaction!.kind).toBe('emphasize')
    })

    it('should detect question reaction (2005)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const questionReaction = messages.find((m) => m.text?.includes('Questioned'))

        expect(questionReaction).toBeDefined()
        expect(questionReaction!.reaction).not.toBeNull()
        expect(questionReaction!.reaction!.kind).toBe('question')
    })

    it('should detect emoji tapback (2006)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const emojiReaction = messages.find((m) => m.reaction?.kind === 'emoji' && !m.reaction.isRemoved)

        expect(emojiReaction).toBeDefined()
        expect(emojiReaction!.reaction!.kind).toBe('emoji')
        expect(emojiReaction!.reaction!.emoji).toBe('😍')
        expect(emojiReaction!.reaction!.isRemoved).toBe(false)
    })

    it('should detect sticker tapback (2007)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const stickerReaction = messages.find((m) => m.reaction?.kind === 'sticker' && !m.reaction.isRemoved)

        expect(stickerReaction).toBeDefined()
        expect(stickerReaction!.reaction!.kind).toBe('sticker')
        expect(stickerReaction!.reaction!.isRemoved).toBe(false)
    })

    it('should detect reaction removal (3000)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const removalReaction = messages.find((m) => m.reaction?.kind === 'love' && m.reaction.isRemoved)

        expect(removalReaction).toBeDefined()
        expect(removalReaction!.reaction!.kind).toBe('love')
        expect(removalReaction!.reaction!.isRemoved).toBe(true)
    })

    it('should detect emoji tapback removal (3006)', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const emojiRemoval = messages.find((m) => m.reaction?.kind === 'emoji' && m.reaction.isRemoved)

        expect(emojiRemoval).toBeDefined()
        expect(emojiRemoval!.reaction!.kind).toBe('emoji')
        expect(emojiRemoval!.reaction!.isRemoved).toBe(true)
        expect(emojiRemoval!.reaction!.emoji).toBe('😍')
    })

    it('should have null emoji for classic tapbacks', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20 })

        const loveReaction = messages.find((m) => m.reaction?.kind === 'love' && !m.reaction.isRemoved)

        expect(loveReaction).toBeDefined()
        expect(loveReaction!.reaction!.emoji).toBeNull()
    })

    it('should preserve targetGuid for reactions', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 25 })

        const reactions = messages.filter((m) => m.reaction !== null)

        expect(reactions.length).toBeGreaterThanOrEqual(10)
        for (const r of reactions) {
            expect(r.reaction!.targetMessageId).toBe(originalMessageGuid)
        }
    })

    it('should map associated_message_range_* to reaction.range', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 25 })
        const ranged = messages.find((m) => m.text === 'Ranged tapback row')

        expect(ranged?.reaction?.textRange).toEqual({ location: 7, length: 5 })
    })

    it('should default reaction.range to 0,0 when columns are unset', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 25 })
        const love = messages.find((m) => m.reaction?.kind === 'love' && m.text?.includes('Loved'))

        expect(love?.reaction?.textRange).toEqual({ location: 0, length: 0 })
    })

    it('should exclude reactions with excludeReactions filter', async () => {
        const database = new MessagesDatabaseReader(dbPath)
        const messages = await database.getMessages({ limit: 20, excludeReactions: true })

        const reactions = messages.filter((m) => m.reaction !== null)
        expect(reactions.length).toBe(0)

        // Should still have regular messages
        expect(messages.length).toBeGreaterThan(0)
    })

    it('should handle invalid reaction type values gracefully', async () => {
        // Insert message with invalid type (e.g., 9999)
        const { db, path, cleanup: c } = createMockDatabase()
        insertTestMessage(db, {
            text: 'Invalid type message',
            sender: '+9999999999',
            associatedMessageType: 9999,
            associatedMessageGuid: 'some-guid',
        })

        const database = new MessagesDatabaseReader(path)
        const messages = await database.getMessages({ limit: 1 })

        // Should treat as non-reaction
        expect(messages[0].reaction).toBeNull()

        c()
    })
})
