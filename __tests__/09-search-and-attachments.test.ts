import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
    attachmentExists,
    getAttachmentExtension,
    isAudioAttachment,
    isImageAttachment,
    isVideoAttachment,
} from '../src/infra/attachments'
import { IMessageSDK } from '../src/sdk'
import { cleanupTempDir, createMockDatabase, insertTestMessage } from './setup'

// Mock platform
mock.module('../src/infra/platform', () => ({
    requireMacOS: () => {},
    getDefaultDatabasePath: () => '/mock/path/chat.db',
    getDarwinMajorVersion: () => 24,
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
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const messages = await sdk.getMessages({ search: 'meeting' })

        expect(messages.length).toBe(2)
        expect(messages.every((m) => m.text?.toLowerCase().includes('meeting'))).toBe(true)
    })

    it('search is case-insensitive', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const messages = await sdk.getMessages({ search: 'MEETING' })

        expect(messages.length).toBe(2)
    })

    it('combines search with other filters', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const messages = await sdk.getMessages({
            search: 'meeting',
            isRead: false,
        })

        expect(messages.length).toBe(1)
        expect(messages[0].text).toContain('Meeting at 3pm')
    })

    it('returns empty results for no matches', async () => {
        const sdk = new IMessageSDK({ databasePath: dbPath })
        const messages = await sdk.getMessages({ search: 'nonexistent' })

        expect(messages.length).toBe(0)
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
        id: 'att-1',
        fileName: filename,
        localPath: filePath,
        mimeType,
        uti: null,
        sizeBytes: 0,
        transferStatus: 'complete' as const,
        isFromMe: false,
        isSticker: false,
        isSensitiveContent: false,
        altText: null,
        createdAt: new Date(),
    })

    it('checks if attachment exists', async () => {
        const attachment = createAttachment(testFile, 'test.jpg', 'image/jpeg')
        expect(await attachmentExists(attachment)).toBe(true)

        const nonExistent = createAttachment('/nonexistent/file.jpg', 'file.jpg', 'image/jpeg')
        expect(await attachmentExists(nonExistent)).toBe(false)
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

    it('identifies video attachments', () => {
        expect(isVideoAttachment(createAttachment('/v.mp4', 'v.mp4', 'video/mp4'))).toBe(true)
        expect(isVideoAttachment(createAttachment('/v.mov', 'v.mov', 'video/quicktime'))).toBe(true)
        expect(isVideoAttachment(createAttachment('/v.jpg', 'v.jpg', 'image/jpeg'))).toBe(false)
    })

    it('identifies audio attachments', () => {
        expect(isAudioAttachment(createAttachment('/a.mp3', 'a.mp3', 'audio/mpeg'))).toBe(true)
        expect(isAudioAttachment(createAttachment('/a.m4a', 'a.m4a', 'audio/mp4'))).toBe(true)
        expect(isAudioAttachment(createAttachment('/a.jpg', 'a.jpg', 'image/jpeg'))).toBe(false)
    })
})
