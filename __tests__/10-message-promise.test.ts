/**
 * MessagePromise Tests
 */

import { describe, expect, test } from 'bun:test'
import { MessagePromise } from '../src/core/message-promise'
import type { Message } from '../src/types/message'

describe('MessagePromise', () => {
    const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
        id: '123',
        guid: 'test-guid',
        text: 'Hello',
        sender: 'test@example.com',
        senderName: null,
        chatId: 'pilot@photon.codes',
        isGroupChat: false,
        service: 'iMessage',
        isRead: false,
        isFromMe: true,
        attachments: [],
        date: new Date(),
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

            const message = createMockMessage({ chatId: 'chat123', isGroupChat: true })
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
                        id: '1',
                        filename: 'test.jpg',
                        mimeType: 'image/jpeg',
                        path: '/path/to/test.jpg',
                        size: 1024,
                        isImage: true,
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
                        id: '1',
                        filename: 'test.png', // Different extension
                        mimeType: 'image/png',
                        path: '/path/to/test.png',
                        size: 1024,
                        isImage: true,
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
                date: new Date(now - 10000),
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
                date: new Date(now - 2000),
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

            const message1 = createMockMessage({ id: '1' })
            const message2 = createMockMessage({ id: '2' })

            promise.resolve(message1)
            promise.resolve(message2) // Should be ignored

            const result = await promise.promise
            expect(result.id).toBe('1')
        })
    })
})
