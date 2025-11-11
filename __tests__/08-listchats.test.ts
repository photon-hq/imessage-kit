import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { IMessageDatabase } from '../src/core/database'
import { IMessageSDK } from '../src/core/sdk'
import { cleanupTempDir, createMockDatabase, insertTestMessage } from './setup'

// Mock platform to avoid macOS restriction during tests
mock.module('../src/utils/platform', () => ({
    requireMacOS: () => {},
    isMacOS: () => true,
    getDefaultDatabasePath: () => '/mock/path/chat.db',
}))

describe('listChats', () => {
    let dbPath: string
    let cleanup: () => void

    beforeAll(() => {
        const { db, path, cleanup: c } = createMockDatabase()
        dbPath = path
        cleanup = c

        // DM chat: iMessage, address +1234567890
        insertTestMessage(db, {
            text: 'hello dm',
            sender: '+1234567890',
            service: 'iMessage',
            isFromMe: false,
            isRead: false,
            date: Date.now() - 2000,
        })

        // Group chat with GUID
        insertTestMessage(db, {
            text: 'hello group',
            sender: '+2222222222',
            service: 'iMessage',
            chatGuid: 'chatTEST1234567890',
            participants: ['+3333333333'],
            isFromMe: false,
            isRead: false,
            date: Date.now() - 1000,
        })
    })

    afterAll(() => {
        cleanup()
        // remove temp dir if any was created
        try {
            cleanupTempDir(dbPath)
        } catch {}
    })

    it('returns chat summaries with correct chatId formats', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })
        const chats = await sdk.listChats()

        // Expect at least two chats: one DM and one group
        expect(chats.length).toBeGreaterThanOrEqual(2)

        const dm = chats.find((c) => c.chatId === 'iMessage;+1234567890')
        const group = chats.find((c) => c.chatId === 'chatTEST1234567890')

        expect(dm).toBeTruthy()
        expect(group).toBeTruthy()

        expect(dm!.isGroup).toBe(false)
        expect(group!.isGroup).toBe(true)

        expect(dm!.displayName).toBeNull()
        expect(group!.displayName).toBeNull()

        expect(dm!.lastMessageAt).not.toBeNull()
        expect(group!.lastMessageAt).not.toBeNull()

        // Check unreadCount
        expect(dm!.unreadCount).toBe(1)
        expect(group!.unreadCount).toBe(1)
    })

    it('respects limit parameter', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })
        const chatsLimited = await sdk.listChats(1)
        expect(chatsLimited.length).toBe(1)
    })

    it('filters by type', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })

        const groups = await sdk.listChats({ type: 'group' })
        expect(groups.every((c) => c.isGroup)).toBe(true)

        const dms = await sdk.listChats({ type: 'dm' })
        expect(dms.every((c) => !c.isGroup)).toBe(true)
    })

    it('filters by unread status', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })

        const unread = await sdk.listChats({ hasUnread: true })
        expect(unread.every((c) => c.unreadCount > 0)).toBe(true)
    })
})
