/**
 * SDK Core Tests
 *
 * Tests for main IMessageSDK class
 */

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { MessageSender } from '../src/infra/outgoing/sender'
import { IMessageSDK } from '../src/sdk'
import { createMockDatabase, createSpy, insertTestMessage } from './setup'

// Mock platform check to run tests on any OS
mock.module('../src/infra/platform', () => ({
    requireMacOS: () => {},
    getDefaultDatabasePath: () => '/mock/path/chat.db',
    getDarwinMajorVersion: () => 24,
}))

describe('IMessageSDK', () => {
    let mockDb: { db: Database; path: string; cleanup: () => void }
    let sdk!: IMessageSDK

    const createSdk = (config: ConstructorParameters<typeof IMessageSDK>[0] = {}) =>
        new IMessageSDK({ databasePath: mockDb.path, ...config })

    const withMockedSend = async (impl: (options: any) => Promise<any>, run: () => Promise<void>) => {
        const previousSend = MessageSender.prototype.send
        ;(MessageSender.prototype.send as any) = impl

        try {
            await run()
        } finally {
            MessageSender.prototype.send = previousSend
        }
    }

    beforeEach(() => {
        mockDb = createMockDatabase()
    })

    afterEach(async () => {
        if (sdk) {
            await sdk.close()
        }

        mockDb.cleanup()
    })

    describe('Constructor', () => {
        it('should initialize with default config', () => {
            sdk = createSdk()

            expect(sdk).toBeInstanceOf(IMessageSDK)
        })

        it('should accept custom configuration', () => {
            sdk = createSdk({
                debug: true,
                maxConcurrentSends: 10,
            })

            expect(sdk).toBeInstanceOf(IMessageSDK)
        })

        it('should register plugins from config', async () => {
            const initSpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'test-plugin',
                        onInit: initSpy.fn,
                    },
                ],
            })

            // Trigger plugin initialization
            await sdk.getMessages()

            expect(initSpy.callCount()).toBeGreaterThan(0)
        })
    })

    describe('use', () => {
        it('should register plugin after initialization', async () => {
            sdk = createSdk()

            const initSpy = createSpy<() => void>()
            sdk.use({
                name: 'late-plugin',
                onInit: initSpy.fn,
            })

            expect(initSpy.callCount()).toBe(0) // Not initialized yet
        })

        it('should support method chaining', async () => {
            sdk = createSdk()

            const result = sdk.use({ name: 'plugin1' }).use({ name: 'plugin2' })

            expect(result).toBe(sdk)
        })
    })

    describe('getMessages', () => {
        it('should query messages from database', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Test message',
                sender: '+1234567890',
            })

            sdk = createSdk()

            const messages = await sdk.getMessages()

            expect(messages.length).toBe(1)
            expect(messages[0]?.text).toBe('Test message')
        })

        it('should support filters', async () => {
            insertTestMessage(mockDb.db, {
                text: 'Unread',
                sender: '+1111111111',
                isRead: false,
            })
            insertTestMessage(mockDb.db, {
                text: 'Read',
                sender: '+2222222222',
                isRead: true,
            })

            sdk = createSdk()

            const messages = await sdk.getMessages({ unreadOnly: true })

            expect(messages.length).toBe(1)
            expect(messages[0]?.text).toBe('Unread')
        })
    })

    describe('message', () => {
        it('should create message chain', async () => {
            sdk = createSdk()

            const mockMessage: any = {
                rowId: 1,
                text: 'Hello',
                sender: '+1234567890',
                isFromMe: false,
            }

            const chain = sdk.message(mockMessage)

            expect(chain).toBeDefined()
            expect(typeof chain.ifFromOthers).toBe('function')
            expect(typeof chain.matchText).toBe('function')
            expect(typeof chain.replyText).toBe('function')
        })

        it('should route chain replies through the unified SDK send hooks', async () => {
            const beforeSendSpy = createSpy<() => void>()
            const afterSendSpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'chain-send-hooks',
                        onBeforeSend: beforeSendSpy.fn,
                        onAfterSend: afterSendSpy.fn,
                    },
                ],
            })

            await withMockedSend(
                async () => ({ status: 'sent', sentAt: new Date() }),
                async () => {
                    await sdk
                        .message({
                            rowId: 1,
                            id: 'msg-1',
                            chatId: '+1234567890',
                            chatKind: 'dm',
                            participant: '+1234567890',
                            service: 'iMessage',
                            text: 'ping',
                            kind: 'text',
                            isFromMe: false,
                            isRead: false,
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
                            segmentCount: 1,
                            reaction: null,
                            attachments: [],
                        })
                        .replyText('pong')
                        .execute()
                }
            )

            expect(beforeSendSpy.callCount()).toBe(1)
            expect(afterSendSpy.callCount()).toBe(1)
        })

        it('should reject chain execution after the SDK is closed', async () => {
            sdk = createSdk()

            const chain = sdk.message({
                rowId: 1,
                id: 'msg-1',
                chatId: '+1234567890',
                chatKind: 'dm',
                participant: '+1234567890',
                service: 'iMessage',
                text: 'ping',
                kind: 'text',
                isFromMe: false,
                isRead: false,
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
                segmentCount: 1,
                reaction: null,
                attachments: [],
            })

            await sdk.close()

            const result = await chain.replyText('pong').execute()
            expect(result.errors.length).toBe(1)
            expect(result.errors[0]?.message).toBe('SDK is destroyed')
        })
    })

    describe('startWatching', () => {
        it('should initialize plugins before starting watcher flow', async () => {
            const initSpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'watch-plugin',
                        onInit: initSpy.fn,
                    },
                ],
            })

            await sdk.startWatching()

            expect(initSpy.callCount()).toBeGreaterThan(0)

            sdk.stopWatching()
        })
    })

    describe('close', () => {
        it('should close SDK and release resources', async () => {
            sdk = createSdk()

            await sdk.close()
            // Should complete without errors
        })

        it('should call plugin onDestroy hooks', async () => {
            const destroySpy = createSpy<() => void>()

            sdk = createSdk({
                plugins: [
                    {
                        name: 'test',
                        onDestroy: destroySpy.fn,
                    },
                ],
            })

            await sdk.close()

            expect(destroySpy.callCount()).toBe(1)
        })

        it('should allow multiple close calls', async () => {
            sdk = createSdk()

            await sdk.close()
            await sdk.close() // Should not throw
        })

        it('should throw error when using SDK after close', async () => {
            sdk = createSdk()

            await sdk.close()

            await expect(sdk.getMessages()).rejects.toThrow('SDK is destroyed')
        })
    })

    describe('Symbol.dispose', () => {
        it('should support using declaration', async () => {
            const destroySpy = createSpy<() => void>()

            {
                await using localSdk = createSdk({
                    plugins: [
                        {
                            name: 'test',
                            onDestroy: destroySpy.fn,
                        },
                    ],
                })

                // Use SDK
                await localSdk.getMessages()
            }

            // SDK should be automatically cleaned up
            await new Promise((resolve) => setTimeout(resolve, 100))
            expect(destroySpy.callCount()).toBeGreaterThan(0)
        })
    })

    describe('File Sending API', () => {
        it('should stop and mark later items as skipped when continueOnError is false', async () => {
            await withMockedSend(
                async (options: { to: string }) => {
                    if (options.to === '+1000000002') {
                        throw new Error('Send failed')
                    }

                    return { status: 'sent' as const, sentAt: new Date() }
                },
                async () => {
                    sdk = createSdk()

                    const result = await sdk.sendBatch(
                        [
                            { to: '+1000000001', text: 'First' },
                            { to: '+1000000002', text: 'Second' },
                            { to: '+1000000003', text: 'Third' },
                        ],
                        {
                            concurrency: 1,
                            continueOnError: false,
                        }
                    )

                    expect(result.sent + result.failed + result.skipped).toBe(3)
                    expect(result.sent).toBe(1)
                    expect(result.failed).toBe(1)
                    expect(result.skipped).toBe(1)
                    expect(result.results[0]?.status).toBe('sent')
                    expect(result.results[1]?.status).toBe('failed')
                    expect(result.results[2]?.status).toBe('skipped')
                }
            )
        })

        it('should respect the configured batch concurrency limit', async () => {
            let inFlight = 0
            let maxInFlight = 0

            await withMockedSend(
                async () => {
                    inFlight += 1
                    maxInFlight = Math.max(maxInFlight, inFlight)

                    try {
                        await new Promise((resolve) => setTimeout(resolve, 25))
                        return { status: 'sent' as const, sentAt: new Date() }
                    } finally {
                        inFlight -= 1
                    }
                },
                async () => {
                    sdk = createSdk()

                    const result = await sdk.sendBatch(
                        [
                            { to: '+1000000001', text: 'One' },
                            { to: '+1000000002', text: 'Two' },
                            { to: '+1000000003', text: 'Three' },
                            { to: '+1000000004', text: 'Four' },
                        ],
                        {
                            concurrency: 2,
                        }
                    )

                    expect(result.sent).toBe(4)
                    expect(result.failed).toBe(0)
                    expect(result.skipped).toBe(0)
                    expect(maxInFlight).toBe(2)
                }
            )
        })

        it('should accept files parameter in send()', async () => {
            const sendSpy = createSpy<(options: any) => Promise<{ status: 'sent'; sentAt: Date }>>(() =>
                Promise.resolve({ status: 'sent', sentAt: new Date() })
            )

            await withMockedSend(sendSpy.fn, async () => {
                sdk = createSdk()

                await sdk.send('+1234567890', {
                    attachments: ['/path/to/file.pdf', '/path/to/contact.vcf'],
                })
            })

            expect(sendSpy.callCount()).toBe(1)
            const callArgs = sendSpy.getCalls()[0]
            expect(callArgs.attachments).toEqual(['/path/to/file.pdf', '/path/to/contact.vcf'])
        })

        it('should send text with attachments', async () => {
            const sendSpy = createSpy<(options: any) => Promise<{ status: 'sent'; sentAt: Date }>>(() =>
                Promise.resolve({ status: 'sent', sentAt: new Date() })
            )

            await withMockedSend(sendSpy.fn, async () => {
                sdk = createSdk()

                await sdk.send('+1234567890', {
                    text: 'Check these',
                    attachments: ['/image.jpg', '/document.pdf'],
                })
            })

            expect(sendSpy.callCount()).toBe(1)
            const callArgs = sendSpy.getCalls()[0]
            expect(callArgs.attachments).toEqual(['/image.jpg', '/document.pdf'])
            expect(callArgs.text).toBe('Check these')
        })

        it('should support sendFile() convenience method', async () => {
            const sendSpy = createSpy<(options: any) => Promise<{ status: 'sent'; sentAt: Date }>>(() =>
                Promise.resolve({ status: 'sent', sentAt: new Date() })
            )

            await withMockedSend(sendSpy.fn, async () => {
                sdk = createSdk()

                await sdk.sendFile('+1234567890', '/path/to/document.pdf', 'Here is the file')
            })

            expect(sendSpy.callCount()).toBe(1)
            const callArgs = sendSpy.getCalls()[0]
            expect(callArgs.attachments).toEqual(['/path/to/document.pdf'])
            expect(callArgs.text).toBe('Here is the file')
        })

        it('should support sendFiles() convenience method', async () => {
            const sendSpy = createSpy<(options: any) => Promise<{ status: 'sent'; sentAt: Date }>>(() =>
                Promise.resolve({ status: 'sent', sentAt: new Date() })
            )

            await withMockedSend(sendSpy.fn, async () => {
                sdk = createSdk()

                await sdk.sendFiles('+1234567890', ['/file1.pdf', '/file2.csv'])
            })

            expect(sendSpy.callCount()).toBe(1)
            const callArgs = sendSpy.getCalls()[0]
            expect(callArgs.attachments).toEqual(['/file1.pdf', '/file2.csv'])
        })
    })
})
