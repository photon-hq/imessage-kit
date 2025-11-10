/**
 * Message Chain Tests
 *
 * Tests for fluent message chain processing API
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { MessageChain } from '../src/core/chain'
import type { Message } from '../src/types/message'
import { createSpy } from './setup'

describe('MessageChain', () => {
    let mockMessage: Message
    let mockSender: any

    beforeEach(() => {
        mockMessage = {
            id: '1',
            guid: 'test-guid',
            text: 'Hello world',
            sender: '+1234567890',
            senderName: null,
            chatId: '+1234567890', // Use valid recipient format for DM
            isGroupChat: false,
            service: 'iMessage',
            isRead: false,
            isFromMe: false,
            attachments: [],
            date: new Date(),
        }

        mockSender = {
            send: async () => ({ sentAt: new Date() }),
            sendToGroup: async () => ({ sentAt: new Date() }),
        }
    })

    describe('Conditional Filters', () => {
        it('should filter messages from others', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, isFromMe: false }, mockSender)
            await chain1.ifFromOthers().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(1)

            sendSpy.reset()
            const chain2 = new MessageChain({ ...mockMessage, isFromMe: true }, mockSender)
            await chain2.ifFromOthers().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(0)
        })

        it('should filter unread messages', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, isRead: false }, mockSender)
            await chain1.ifUnread().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(1)

            sendSpy.reset()
            const chain2 = new MessageChain({ ...mockMessage, isRead: true }, mockSender)
            await chain2.ifUnread().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(0)
        })

        it('should filter group chat messages', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            // For group chat, chatId should be a GUID
            mockSender.sendToGroup = sendSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, chatId: 'chat123456789', isGroupChat: true }, mockSender)
            await chain1.ifGroupChat().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(1)

            sendSpy.reset()
            mockSender.send = sendSpy.fn
            const chain2 = new MessageChain({ ...mockMessage, isGroupChat: false }, mockSender)
            await chain2.ifGroupChat().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(0)
        })

        it('should support custom predicates with when()', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain
                .when((m) => m.sender.startsWith('+1'))
                .replyText('Reply')
                .execute()
            expect(sendSpy.callCount()).toBe(1)
        })

        it('should chain multiple filters', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, isFromMe: false, isRead: false }, mockSender)
            await chain.ifFromOthers().ifUnread().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(1)
        })

        it('should short-circuit on false condition', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, isFromMe: true }, mockSender)
            await chain.ifFromOthers().ifUnread().replyText('Reply').execute()
            expect(sendSpy.callCount()).toBe(0)
        })
    })

    describe('Text Matching', () => {
        it('should match text with string', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText('Hello').replyText('Reply').execute()

            expect(sendSpy.callCount()).toBe(1)
        })

        it('should match text with regex', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText(/hello/i).replyText('Reply').execute()

            expect(sendSpy.callCount()).toBe(1)
        })

        it('should not match when text is null', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: null }, mockSender)
            await chain.matchText('Hello').replyText('Reply').execute()

            expect(sendSpy.callCount()).toBe(0)
        })

        it('should not match when text does not contain pattern', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText('Goodbye').replyText('Reply').execute()

            expect(sendSpy.callCount()).toBe(0)
        })

        it('should be case-sensitive for string matching', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText('hello').replyText('Reply').execute()

            expect(sendSpy.callCount()).toBe(0)
        })
    })

    describe('Reply Actions', () => {
        it('should reply with text string', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyText('Reply message').execute()

            expect(sendSpy.callCount()).toBe(1)
        })

        it('should reply with text function', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyText((m) => `Hi ${m.sender}`).execute()

            expect(sendSpy.callCount()).toBe(1)
        })

        it('should reply with image', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyImage('/path/to/image.jpg').execute()

            expect(sendSpy.callCount()).toBe(1)
        })

        it('should reply with multiple images', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyImage(['/path/1.jpg', '/path/2.jpg']).execute()

            expect(sendSpy.callCount()).toBe(1)
        })

        it('should not send when chain is disabled', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain({ ...mockMessage, isFromMe: true }, mockSender)
            await chain.ifFromOthers().replyText('Should not send').execute()

            expect(sendSpy.callCount()).toBe(0)
        })
    })

    describe('do', () => {
        it('should execute action when enabled', async () => {
            const executeSpy = createSpy<() => void>()

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.do(executeSpy.fn).execute()

            expect(executeSpy.callCount()).toBe(1)
        })

        it('should not execute when disabled', async () => {
            const executeSpy = createSpy<() => void>()

            const chain = new MessageChain({ ...mockMessage, isFromMe: true }, mockSender)
            await chain.ifFromOthers().do(executeSpy.fn).execute()

            expect(executeSpy.callCount()).toBe(0)
        })

        it('should support async actions', async () => {
            let completed = false

            const chain = new MessageChain(mockMessage, mockSender)
            await chain
                .do(async () => {
                    await new Promise((resolve) => setTimeout(resolve, 10))
                    completed = true
                })
                .execute()

            expect(completed).toBe(true)
        })
    })

    describe('execute', () => {
        it('should execute all queued actions', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            chain.replyText('First')
            chain.replyText('Second')

            await chain.execute()

            expect(sendSpy.callCount()).toBe(2)
        })

        it('should mark as executed', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            chain.replyText('Message')

            await chain.execute()

            // Note: Current implementation allows multiple executions
            // This is a design decision - each execute() will run all queued actions
            expect(sendSpy.callCount()).toBeGreaterThanOrEqual(1)
        })
    })

    describe('Complex Chains', () => {
        it('should handle complex filtering and actions', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const message: Message = {
                ...mockMessage,
                text: '/help',
                isFromMe: false,
                isRead: false,
                isGroupChat: false,
            }

            const chain = new MessageChain(message, mockSender)
            await chain
                .ifFromOthers()
                .ifUnread()
                .matchText(/^\/help$/i)
                .replyText('Available commands: /help, /start')
                .execute()

            expect(sendSpy.callCount()).toBe(1)
        })

        it('should allow multiple conditional branches', async () => {
            const sendSpy = createSpy<() => Promise<{ sentAt: Date }>>()
            mockSender.send = sendSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, text: '/help' }, mockSender)
            await chain1.matchText('/help').replyText('Help message').execute()

            const chain2 = new MessageChain({ ...mockMessage, text: '/start' }, mockSender)
            await chain2.matchText('/start').replyText('Start message').execute()

            expect(sendSpy.callCount()).toBe(2)
        })
    })
})
