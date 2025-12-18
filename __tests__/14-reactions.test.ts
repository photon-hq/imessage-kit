/**
 * Reaction Detection Tests
 *
 * Tests for tapback reaction (love, like, dislike, laugh, emphasize, question)
 * detection and parsing in messages.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { IMessageDatabase } from '../src/core/database'
import { createMockDatabase, insertTestMessage } from './setup'

// Mock platform
mock.module('../src/utils/platform', () => ({
    isMacOS: () => true,
    getDefaultDatabasePath: () => '/tmp/mock-chat.db',
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

        // 3000 = remove love (reaction removal)
        insertTestMessage(db, {
            text: 'Removed a heart from "Hello"',
            sender: '+7777777777',
            associatedMessageType: 3000,
            associatedMessageGuid: originalMessageGuid,
        })
    })

    afterAll(() => {
        cleanup()
    })

    it('should identify regular message as not a reaction', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        // Find message that is NOT a reaction (associatedMessageGuid is null)
        const regularMessage = result.messages.find((m) => m.associatedMessageGuid === null)

        expect(regularMessage).toBeDefined()
        expect(regularMessage!.isReaction).toBe(false)
        expect(regularMessage!.reactionType).toBeNull()
        expect(regularMessage!.isReactionRemoval).toBe(false)
        expect(regularMessage!.associatedMessageGuid).toBeNull()
    })

    it('should detect love reaction (2000)', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const loveReaction = result.messages.find((m) => m.text?.includes('Loved'))

        expect(loveReaction).toBeDefined()
        expect(loveReaction!.isReaction).toBe(true)
        expect(loveReaction!.reactionType).toBe('love')
        expect(loveReaction!.isReactionRemoval).toBe(false)
        expect(loveReaction!.associatedMessageGuid).toBe(originalMessageGuid)
    })

    it('should detect like reaction (2001)', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const likeReaction = result.messages.find((m) => m.text?.includes('Liked'))

        expect(likeReaction).toBeDefined()
        expect(likeReaction!.isReaction).toBe(true)
        expect(likeReaction!.reactionType).toBe('like')
    })

    it('should detect dislike reaction (2002)', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const dislikeReaction = result.messages.find((m) => m.text?.includes('Disliked'))

        expect(dislikeReaction).toBeDefined()
        expect(dislikeReaction!.isReaction).toBe(true)
        expect(dislikeReaction!.reactionType).toBe('dislike')
    })

    it('should detect laugh reaction (2003)', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const laughReaction = result.messages.find((m) => m.text?.includes('Laughed'))

        expect(laughReaction).toBeDefined()
        expect(laughReaction!.isReaction).toBe(true)
        expect(laughReaction!.reactionType).toBe('laugh')
    })

    it('should detect emphasize reaction (2004)', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const emphasizeReaction = result.messages.find((m) => m.text?.includes('Emphasized'))

        expect(emphasizeReaction).toBeDefined()
        expect(emphasizeReaction!.isReaction).toBe(true)
        expect(emphasizeReaction!.reactionType).toBe('emphasize')
    })

    it('should detect question reaction (2005)', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const questionReaction = result.messages.find((m) => m.text?.includes('Questioned'))

        expect(questionReaction).toBeDefined()
        expect(questionReaction!.isReaction).toBe(true)
        expect(questionReaction!.reactionType).toBe('question')
    })

    it('should detect reaction removal (3000)', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const removalReaction = result.messages.find((m) => m.text?.includes('Removed a heart'))

        expect(removalReaction).toBeDefined()
        expect(removalReaction!.isReaction).toBe(true)
        expect(removalReaction!.reactionType).toBe('love')
        expect(removalReaction!.isReactionRemoval).toBe(true)
    })

    it('should preserve associatedMessageGuid for reactions', async () => {
        const database = new IMessageDatabase(dbPath)
        const result = await database.getMessages({ limit: 10 })

        const reactions = result.messages.filter((m) => m.isReaction)

        expect(reactions.length).toBeGreaterThanOrEqual(7)
        for (const r of reactions) {
            expect(r.associatedMessageGuid).toBe(originalMessageGuid)
        }
    })
})
