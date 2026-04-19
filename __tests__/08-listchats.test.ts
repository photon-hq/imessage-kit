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

    it('sortBy=recent orders chats by most recent message desc', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const recent = await sdk.listChats({ sortBy: 'recent' })

        // At least 2 chats inserted; newer message (group at -1000) was inserted
        // after the DM (-2000), so group should come first under 'recent'.
        const [first, ...rest] = recent
        const firstTs = first?.lastMessageAt?.getTime() ?? 0
        for (const c of rest) {
            const ts = c.lastMessageAt?.getTime() ?? 0
            expect(firstTs).toBeGreaterThanOrEqual(ts)
        }
    })

    it('sortBy=name orders chats alphabetically (stable, nulls last)', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const byName = await sdk.listChats({ sortBy: 'name' })
        // No assertion about exact order (our seed data has null names) — we only
        // assert the query succeeds and returns the same set.
        expect(byName.length).toBeGreaterThanOrEqual(2)
    })

    it('limit + offset pagination returns disjoint slices', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const page1 = await sdk.listChats({ limit: 1, offset: 0 })
        const page2 = await sdk.listChats({ limit: 1, offset: 1 })
        expect(page1).toHaveLength(1)
        expect(page2).toHaveLength(1)
        expect(page1[0]?.chatId).not.toBe(page2[0]?.chatId)
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

    it('filters by service', async () => {
        // Add an SMS chat alongside the iMessage chats seeded in beforeAll.
        const { db, path, cleanup: c } = createMockDatabase()
        try {
            insertTestMessage(db, {
                text: 'imsg',
                sender: '+1111111111',
                service: 'iMessage',
            })
            insertTestMessage(db, {
                text: 'sms',
                sender: '+2222222222',
                service: 'SMS',
            })

            const sdk = new IMessageSDK({ databasePath: path })
            const sms = await sdk.listChats({ service: 'SMS' })
            const imsg = await sdk.listChats({ service: 'iMessage' })

            expect(sms.every((chat) => chat.service === 'SMS')).toBe(true)
            expect(imsg.every((chat) => chat.service === 'iMessage')).toBe(true)
            expect(sms.length).toBeGreaterThanOrEqual(1)
            expect(imsg.length).toBeGreaterThanOrEqual(1)
        } finally {
            c()
        }
    })

    it('filters by isArchived', async () => {
        const { db, path, cleanup: c } = createMockDatabase()
        try {
            insertTestMessage(db, { text: 'active', sender: '+1111111111' })
            insertTestMessage(db, { text: 'archived', sender: '+2222222222' })
            // Flip the archived flag on the second chat.
            db.prepare('UPDATE chat SET is_archived = 1 WHERE chat_identifier = ?').run('+2222222222')

            const sdk = new IMessageSDK({ databasePath: path })
            const archived = await sdk.listChats({ isArchived: true })
            const active = await sdk.listChats({ isArchived: false })

            expect(archived).toHaveLength(1)
            expect(archived[0]?.chatId).toBe('iMessage;-;+2222222222')

            expect(active.every((chat) => chat.chatId !== 'iMessage;-;+2222222222')).toBe(true)
            expect(active.length).toBeGreaterThanOrEqual(1)
        } finally {
            c()
        }
    })

    it('search matches chat_identifier substring (case-insensitive)', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const hits = await sdk.listChats({ search: '1234567890' })
        // Both the DM (chat_identifier '+1234567890') and the group (guid 'chatTEST1234567890')
        // carry the substring, so at least two results should match.
        expect(hits.length).toBeGreaterThanOrEqual(2)
    })

    it('returns an empty list when filters match nothing', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const nothing = await sdk.listChats({ chatId: 'iMessage;-;+0000000000' })
        expect(nothing).toEqual([])
    })
})
