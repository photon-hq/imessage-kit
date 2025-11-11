/**
 * OutgoingMessageManager Tests
 */

import { describe, expect, test } from 'bun:test'
import { MessagePromise } from '../src/core/message-promise'
import { OutgoingMessageManager } from '../src/core/outgoing-manager'
import type { Message } from '../src/types/message'

describe('OutgoingMessageManager', () => {
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

    test('should add and track promises', () => {
        const manager = new OutgoingMessageManager()
        const promise = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'Hello',
            isAttachment: false,
            sentAt: Date.now(),
        })

        manager.add(promise)
        expect(manager.getPendingCount()).toBe(1)
    })

    test('should resolve matching message', () => {
        const manager = new OutgoingMessageManager()
        const promise = new MessagePromise({
            chatId: 'iMessage;-;pilot@photon.codes',
            text: 'Hello',
            isAttachment: false,
            sentAt: Date.now(),
        })

        manager.add(promise)

        const message = createMockMessage({ text: 'Hello', chatId: 'pilot@photon.codes' })
        const matched = manager.tryResolve(message)

        expect(matched).toBe(true)
        expect(promise.isResolved).toBe(true)
    })

    test('should not resolve non-matching message', () => {
        const manager = new OutgoingMessageManager()
        const promise = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'Hello',
            isAttachment: false,
            sentAt: Date.now(),
        })

        manager.add(promise)

        const message = createMockMessage({ text: 'Goodbye' })
        const matched = manager.tryResolve(message)

        expect(matched).toBe(false)
        expect(promise.isResolved).toBe(false)
    })

    test('should not resolve messages from others', () => {
        const manager = new OutgoingMessageManager()
        const promise = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'Hello',
            isAttachment: false,
            sentAt: Date.now(),
        })

        manager.add(promise)

        const message = createMockMessage({ text: 'Hello', isFromMe: false })
        const matched = manager.tryResolve(message)

        expect(matched).toBe(false)
    })

    test('should cleanup resolved promises', () => {
        const manager = new OutgoingMessageManager()
        const promise = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'Hello',
            isAttachment: false,
            sentAt: Date.now() - 70000, // 70 seconds ago
        })

        manager.add(promise)
        promise.resolve(createMockMessage())

        expect(manager.getPendingCount()).toBe(0)

        manager.cleanup()
        // Resolved promises older than 1 minute should be removed
    })

    test('should reject all pending on rejectAll', async () => {
        const manager = new OutgoingMessageManager()
        const promise1 = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'Hello',
            isAttachment: false,
            sentAt: Date.now(),
        })
        const promise2 = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'World',
            isAttachment: false,
            sentAt: Date.now(),
        })

        manager.add(promise1)
        manager.add(promise2)

        manager.rejectAll('Test rejection')

        // Wait for promises to be rejected
        await Promise.allSettled([promise1.promise, promise2.promise])

        expect(promise1.isResolved).toBe(true)
        expect(promise1.errored).toBe(true)
        expect(promise2.isResolved).toBe(true)
        expect(promise2.errored).toBe(true)
    })

    test('should handle multiple promises for same chat', () => {
        const manager = new OutgoingMessageManager()
        const promise1 = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'Hello',
            isAttachment: false,
            sentAt: Date.now(),
        })
        const promise2 = new MessagePromise({
            chatId: 'pilot@photon.codes',
            text: 'World',
            isAttachment: false,
            sentAt: Date.now(),
        })

        manager.add(promise1)
        manager.add(promise2)

        // Resolve first message
        const message1 = createMockMessage({ text: 'Hello' })
        manager.tryResolve(message1)

        expect(promise1.isResolved).toBe(true)
        expect(promise2.isResolved).toBe(false)

        // Resolve second message
        const message2 = createMockMessage({ text: 'World' })
        manager.tryResolve(message2)

        expect(promise2.isResolved).toBe(true)
    })
})
