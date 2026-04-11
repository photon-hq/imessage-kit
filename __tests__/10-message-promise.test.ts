/**
 * MessagePromise Tests
 */

import { describe, expect, test } from 'bun:test'
import type { Message } from '../src/domain/message'
import { MessagePromise } from '../src/infra/outgoing/tracker'

describe('MessagePromise', () => {
    const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
        rowId: 123,
        id: 'test-guid',
        text: 'Hello',
        kind: 'text',
        chatId: 'pilot@photon.codes',
        chatKind: 'dm',
        participant: 'test@example.com',
        service: 'iMessage',
        isRead: false,
        isFromMe: true,
        isSent: false,
        isDelivered: false,
        isDowngraded: false,
        didNotifyRecipient: false,
        isAutoReply: false,
        isSystem: false,
        isForwarded: false,
        isAudioMessage: false,
        isPlayed: false,
        isExpirable: false,
        hasError: false,
        errorCode: 0,
        isSpam: false,
        isContactKeyVerified: false,
        hasUnseenMention: false,
        wasDeliveredQuietly: false,
        isEmergencySos: false,
        isCriticalAlert: false,
        isOffGridMessage: false,
        attachments: [],
        createdAt: new Date(),
        deliveredAt: null,
        readAt: null,
        playedAt: null,
        editedAt: null,
        retractedAt: null,
        recoveredAt: null,
        replyToMessageId: null,
        threadRootMessageId: null,
        affectedParticipant: null,
        newGroupName: null,
        sendEffect: null,
        appBundleId: null,
        isInvisibleInkRevealed: false,
        expireStatus: 'active',
        shareActivity: 'none',
        shareDirection: 'none',
        scheduleKind: 'none',
        scheduleStatus: 'none',
        segmentCount: 0,
        reaction: null,
        ...overrides,
    })

    describe('Text Matching', () => {
        test('should match exact text', async () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ text: 'Hello' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should match case-insensitive', async () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ text: 'HELLO' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should match ignoring whitespace', async () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: 'Hello World',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ text: 'Hello  World' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should match Chinese text', async () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: '你好世界',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ text: '你好世界' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should match emoji', async () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: 'Hello 🎉',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ text: 'Hello 🎉' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should match mixed Chinese and English', async () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: 'Hello 世界 123',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ text: 'Hello 世界 123' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should not match different text', async () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ text: 'Goodbye' })
            expect(promise.matches(message)).toBe(false)
        })
    })

    describe('ChatId Matching', () => {
        test('should match exact chatId', () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ chatId: 'pilot@photon.codes' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should match normalized chatId (DM)', () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;-;pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ chatId: 'pilot@photon.codes' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should match normalized chatId (Group)', () => {
            const promise = new MessagePromise({
                chatId: 'iMessage;+;chat123',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ chatId: 'chat123', chatKind: 'group' })
            expect(promise.matches(message)).toBe(true)
        })

        test('should not match different chatId', () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ chatId: 'other@example.com' })
            expect(promise.matches(message)).toBe(false)
        })
    })

    describe('Attachment Matching', () => {
        test('should match by attachment filename', () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                attachmentName: 'test.jpg',
                isAttachment: true,
                sentAt: Date.now(),
            })

            const message = createMockMessage({
                attachments: [
                    {
                        id: 'att-1',
                        fileName: 'test.jpg',
                        localPath: '/path/to/test.jpg',
                        mimeType: 'image/jpeg',
                        uti: null,
                        sizeBytes: 1024,
                        transferStatus: 'complete',
                        isOutgoing: false,
                        isSticker: false,
                        isSensitiveContent: false,
                        altText: null,
                        createdAt: new Date(),
                    },
                ],
            })

            expect(promise.matches(message)).toBe(true)
        })

        test('should match attachment without extension', () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                attachmentName: 'test.jpg',
                isAttachment: true,
                sentAt: Date.now(),
            })

            const message = createMockMessage({
                attachments: [
                    {
                        id: 'att-1',
                        fileName: 'test.png', // Different extension
                        localPath: '/path/to/test.png',
                        mimeType: 'image/png',
                        uti: null,
                        sizeBytes: 1024,
                        transferStatus: 'complete',
                        isOutgoing: false,
                        isSticker: false,
                        isSensitiveContent: false,
                        altText: null,
                        createdAt: new Date(),
                    },
                ],
            })

            // Should match by base name
            expect(promise.matches(message)).toBe(true)
        })

        test('should not match message without attachments', () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                attachmentName: 'test.jpg',
                isAttachment: true,
                sentAt: Date.now(),
            })

            const message = createMockMessage({ attachments: [] })
            expect(promise.matches(message)).toBe(false)
        })
    })

    describe('Time Window', () => {
        test('should not match old messages', () => {
            const now = Date.now()
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: now,
            })

            // Message from 10 seconds ago
            const message = createMockMessage({
                text: 'Hello',
                createdAt: new Date(now - 10000),
            })

            expect(promise.matches(message)).toBe(false)
        })

        test('should match recent messages within window', () => {
            const now = Date.now()
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: now,
            })

            // Message from 2 seconds ago (within 5s window)
            const message = createMockMessage({
                text: 'Hello',
                createdAt: new Date(now - 2000),
            })

            expect(promise.matches(message)).toBe(true)
        })
    })

    describe('Promise Resolution', () => {
        test('should resolve with message', async () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message = createMockMessage()
            promise.resolve(message)

            const result = await promise.promise
            expect(result).toBe(message)
            expect(promise.isResolved).toBe(true)
        })

        test('should reject with error', async () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            promise.reject('Test error')

            try {
                await promise.promise
                expect(true).toBe(false) // Should not reach here
            } catch (error: any) {
                expect(error.message).toContain('Test error')
                expect(promise.isResolved).toBe(true)
                expect(promise.errored).toBe(true)
            }
        })

        test('should not resolve twice', async () => {
            const promise = new MessagePromise({
                chatId: 'pilot@photon.codes',
                text: 'Hello',
                isAttachment: false,
                sentAt: Date.now(),
            })

            const message1 = createMockMessage({ rowId: 1 })
            const message2 = createMockMessage({ rowId: 2 })

            promise.resolve(message1)
            promise.resolve(message2) // Should be ignored

            const result = await promise.promise
            expect(result.rowId).toBe(1)
        })
    })
})
