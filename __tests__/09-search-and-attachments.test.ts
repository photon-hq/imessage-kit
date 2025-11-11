import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { IMessageDatabase } from '../src/core/database'
import { IMessageSDK } from '../src/core/sdk'
import {
    attachmentExists,
    downloadAttachment,
    getAttachmentExtension,
    getAttachmentSize,
    isImageAttachment,
} from '../src/helpers/attachment'
import { cleanupTempDir, createMockDatabase, insertTestMessage } from './setup'

// Mock platform
mock.module('../src/utils/platform', () => ({
    requireMacOS: () => {},
    isMacOS: () => true,
    getDefaultDatabasePath: () => '/mock/path/chat.db',
}))

describe('Message Search', () => {
    let dbPath: string
    let cleanup: () => void

    beforeAll(() => {
        const { db, path, cleanup: c } = createMockDatabase()
        dbPath = path
        cleanup = c

        // Insert test messages with different content
        insertTestMessage(db, {
            text: 'Meeting at 3pm tomorrow',
            sender: '+1111111111',
            isRead: false,
        })
        insertTestMessage(db, {
            text: 'Can you send me the report?',
            sender: '+2222222222',
            isRead: false,
        })
        insertTestMessage(db, {
            text: 'The meeting was rescheduled',
            sender: '+3333333333',
            isRead: true,
        })
    })

    afterAll(() => {
        cleanup()
        try {
            cleanupTempDir(dbPath)
        } catch {}
    })

    it('searches messages by text content', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })
        const results = await sdk.getMessages({ search: 'meeting' })

        expect(results.messages.length).toBe(2)
        expect(results.messages.every((m) => m.text?.toLowerCase().includes('meeting'))).toBe(true)
    })

    it('search is case-insensitive', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })
        const results = await sdk.getMessages({ search: 'MEETING' })

        expect(results.messages.length).toBe(2)
    })

    it('combines search with other filters', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })
        const results = await sdk.getMessages({
            search: 'meeting',
            unreadOnly: true,
        })

        expect(results.messages.length).toBe(1)
        expect(results.messages[0].text).toContain('Meeting at 3pm')
    })

    it('returns empty results for no matches', async () => {
        const sdk = new IMessageSDK({}, { database: new IMessageDatabase(dbPath) })
        const results = await sdk.getMessages({ search: 'nonexistent' })

        expect(results.messages.length).toBe(0)
    })
})

describe('Attachment Helpers', () => {
    const testDir = path.join(__dirname, 'test-attachments')
    const testFile = path.join(testDir, 'test.jpg')

    beforeAll(async () => {
        // Create test directory and file
        await fs.promises.mkdir(testDir, { recursive: true })
        await fs.promises.writeFile(testFile, 'test image content')
    })

    afterAll(async () => {
        // Cleanup
        try {
            await fs.promises.rm(testDir, { recursive: true })
        } catch {}
    })

    const createAttachment = (filePath: string, filename: string, mimeType: string) => ({
        id: '1',
        filename,
        mimeType,
        path: filePath,
        size: 0,
        isImage: mimeType.startsWith('image/'),
        createdAt: new Date(),
    })

    it('checks if attachment exists', async () => {
        const attachment = createAttachment(testFile, 'test.jpg', 'image/jpeg')
        expect(await attachmentExists(attachment)).toBe(true)

        const nonExistent = createAttachment('/nonexistent/file.jpg', 'file.jpg', 'image/jpeg')
        expect(await attachmentExists(nonExistent)).toBe(false)
    })

    it('gets attachment file size', async () => {
        const attachment = createAttachment(testFile, 'test.jpg', 'image/jpeg')
        const size = await getAttachmentSize(attachment)

        expect(size).toBeGreaterThan(0)
        expect(size).toBe('test image content'.length)
    })

    it('downloads attachment to destination', async () => {
        const attachment = createAttachment(testFile, 'test.jpg', 'image/jpeg')
        const destPath = path.join(testDir, 'downloaded.jpg')

        await downloadAttachment(attachment, destPath)

        expect(fs.existsSync(destPath)).toBe(true)
        const content = await fs.promises.readFile(destPath, 'utf-8')
        expect(content).toBe('test image content')
    })

    it('gets attachment extension', () => {
        expect(getAttachmentExtension(createAttachment('/path/to/file.jpg', 'file.jpg', 'image/jpeg'))).toBe('jpg')
        expect(getAttachmentExtension(createAttachment('/path/to/file.PNG', 'file.PNG', 'image/png'))).toBe('png')
        expect(getAttachmentExtension(createAttachment('/path/to/file', 'file', 'text/plain'))).toBe('')
    })

    it('identifies image attachments', () => {
        expect(isImageAttachment(createAttachment('/path/to/file.jpg', 'file.jpg', 'image/jpeg'))).toBe(true)
        expect(isImageAttachment(createAttachment('/path/to/file.png', 'file.png', 'image/png'))).toBe(true)
        expect(isImageAttachment(createAttachment('/path/to/file.pdf', 'file.pdf', 'application/pdf'))).toBe(false)
    })
})
