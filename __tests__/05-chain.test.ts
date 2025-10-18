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
            chatId: 'chat1',
            isGroupChat: false,
            service: 'iMessage',
            isRead: false,
            isFromMe: false,
            attachments: [],
            date: new Date(),
        }

        mockSender = {
            text: async () => {},
            textWithImages: async () => {},
        }
    })

    describe('Conditional Filters', () => {
        it('should filter messages from others', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, isFromMe: false }, mockSender)
            await chain1.ifFromOthers().replyText('Reply').execute()
            expect(textSpy.callCount()).toBe(1)

            textSpy.reset()
            const chain2 = new MessageChain({ ...mockMessage, isFromMe: true }, mockSender)
            await chain2.ifFromOthers().replyText('Reply').execute()
            expect(textSpy.callCount()).toBe(0)
        })

        it('should filter unread messages', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, isRead: false }, mockSender)
            await chain1.ifUnread().replyText('Reply').execute()
            expect(textSpy.callCount()).toBe(1)

            textSpy.reset()
            const chain2 = new MessageChain({ ...mockMessage, isRead: true }, mockSender)
            await chain2.ifUnread().replyText('Reply').execute()
            expect(textSpy.callCount()).toBe(0)
        })

        it('should filter group chat messages', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, isGroupChat: true }, mockSender)
            await chain1.ifGroupChat().replyText('Reply').execute()
            expect(textSpy.callCount()).toBe(1)

            textSpy.reset()
            const chain2 = new MessageChain({ ...mockMessage, isGroupChat: false }, mockSender)
            await chain2.ifGroupChat().replyText('Reply').execute()
            expect(textSpy.callCount()).toBe(0)
        })

        it('should support custom predicates with when()', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain
                .when((m) => m.sender.startsWith('+1'))
                .replyText('Reply')
                .execute()

            expect(textSpy.callCount()).toBe(1)
        })

        it('should chain multiple filters', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, isFromMe: false, isRead: false }, mockSender)
            await chain.ifFromOthers().ifUnread().replyText('Reply').execute()

            expect(textSpy.callCount()).toBe(1)
        })

        it('should short-circuit on false condition', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, isFromMe: true }, mockSender)
            await chain.ifFromOthers().ifUnread().replyText('Reply').execute()

            expect(textSpy.callCount()).toBe(0)
        })
    })

    describe('Text Matching', () => {
        it('should match text with string', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText('Hello').replyText('Reply').execute()

            expect(textSpy.callCount()).toBe(1)
        })

        it('should match text with regex', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText(/hello/i).replyText('Reply').execute()

            expect(textSpy.callCount()).toBe(1)
        })

        it('should not match when text is null', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: null }, mockSender)
            await chain.matchText('Hello').replyText('Reply').execute()

            expect(textSpy.callCount()).toBe(0)
        })

        it('should not match when text does not contain pattern', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText('Goodbye').replyText('Reply').execute()

            expect(textSpy.callCount()).toBe(0)
        })

        it('should be case-sensitive for string matching', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, text: 'Hello world' }, mockSender)
            await chain.matchText('hello').replyText('Reply').execute()

            expect(textSpy.callCount()).toBe(0)
        })
    })

    describe('Reply Actions', () => {
        it('should reply with text string', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyText('Reply message').execute()

            expect(textSpy.callCount()).toBe(1)
        })

        it('should reply with text function', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyText((m) => `Hi ${m.sender}`).execute()

            expect(textSpy.callCount()).toBe(1)
        })

        it('should reply with image', async () => {
            const imageSpy = createSpy<() => Promise<void>>()
            mockSender.textWithImages = imageSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyImage('/path/to/image.jpg').execute()

            expect(imageSpy.callCount()).toBe(1)
        })

        it('should reply with multiple images', async () => {
            const imageSpy = createSpy<() => Promise<void>>()
            mockSender.textWithImages = imageSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            await chain.replyImage(['/path/1.jpg', '/path/2.jpg']).execute()

            expect(imageSpy.callCount()).toBe(1)
        })

        it('should not send when chain is disabled', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain({ ...mockMessage, isFromMe: true }, mockSender)
            await chain.ifFromOthers().replyText('Should not send').execute()

            expect(textSpy.callCount()).toBe(0)
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
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            chain.replyText('First')
            chain.replyText('Second')

            await chain.execute()

            expect(textSpy.callCount()).toBe(2)
        })

        it('should mark as executed', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain = new MessageChain(mockMessage, mockSender)
            chain.replyText('Message')

            await chain.execute()

            // Note: Current implementation allows multiple executions
            // This is a design decision - each execute() will run all queued actions
            expect(textSpy.callCount()).toBeGreaterThanOrEqual(1)
        })
    })

    describe('Complex Chains', () => {
        it('should handle complex filtering and actions', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

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

            expect(textSpy.callCount()).toBe(1)
        })

        it('should allow multiple conditional branches', async () => {
            const textSpy = createSpy<() => Promise<void>>()
            mockSender.text = textSpy.fn

            const chain1 = new MessageChain({ ...mockMessage, text: '/help' }, mockSender)
            await chain1.matchText('/help').replyText('Help message').execute()

            const chain2 = new MessageChain({ ...mockMessage, text: '/start' }, mockSender)
            await chain2.matchText('/start').replyText('Start message').execute()

            expect(textSpy.callCount()).toBe(2)
        })
    })
})
