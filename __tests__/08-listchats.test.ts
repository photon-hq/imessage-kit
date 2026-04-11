import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { IMessageSDK } from '../src/sdk'
import { cleanupTempDir, createMockDatabase, insertTestMessage } from './setup'

// Mock platform to avoid macOS restriction during tests
mock.module('../src/infra/platform', () => ({
    requireMacOS: () => {},
    getDefaultDatabasePath: () => '/mock/path/chat.db',
    getDarwinMajorVersion: () => 24,
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
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const chats = await sdk.listChats()

        // Expect at least two chats: one DM and one group
        expect(chats.length).toBeGreaterThanOrEqual(2)

        const dm = chats.find((c) => c.chatId === 'iMessage;-;+1234567890')
        const group = chats.find((c) => c.chatId === 'chatTEST1234567890')

        expect(dm).toBeTruthy()
        expect(group).toBeTruthy()

        expect(dm!.kind).toBe('dm')
        expect(group!.kind).toBe('group')

        expect(dm!.name).toBeNull()
        expect(group!.name).toBeNull()

        expect(dm!.lastMessageAt).not.toBeNull()
        expect(group!.lastMessageAt).not.toBeNull()

        // Check unreadCount
        expect(dm!.unreadCount).toBe(1)
        expect(group!.unreadCount).toBe(1)
    })

    it('respects limit parameter', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const chatsLimited = await sdk.listChats({ limit: 1 })
        expect(chatsLimited.length).toBe(1)
    })

    it('filters by kind', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })

        const groups = await sdk.listChats({ kind: 'group' })
        expect(groups.every((c) => c.kind === 'group')).toBe(true)

        const dms = await sdk.listChats({ kind: 'dm' })
        expect(dms.every((c) => c.kind === 'dm')).toBe(true)
    })

    it('filters by unread status', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })

        const unread = await sdk.listChats({ hasUnread: true })
        expect(unread.every((c) => c.unreadCount > 0)).toBe(true)
    })

    it('filters by chatId through the enriched chat query', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })

        const dm = await sdk.listChats({ chatId: 'iMessage;-;+1234567890' })
        const group = await sdk.listChats({ chatId: 'chatTEST1234567890' })

        expect(dm).toHaveLength(1)
        expect(dm[0]?.chatId).toBe('iMessage;-;+1234567890')

        expect(group).toHaveLength(1)
        expect(group[0]?.chatId).toBe('chatTEST1234567890')
    })
})
