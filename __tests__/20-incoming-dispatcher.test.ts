import { describe, expect, it } from 'bun:test'
import { MessageDispatcher } from '../src/application/message-dispatcher'
import type { Message } from '../src/domain/message'

function createMessage(rowId: number): Message {
    return {
        rowId,
        id: `message-${rowId}`,
        chatId: 'iMessage;-;+1234567890',
        chatKind: 'dm',
        participant: '+1234567890',
        service: 'iMessage',
        text: `text-${rowId}`,
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
        isOffGrid: false,
        createdAt: new Date(rowId * 1000),
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
    }
}

describe('MessageDispatcher', () => {
    it('processes each message sequentially in batch order', async () => {
        const events: string[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onIncomingMessage: async (message) => {
                    events.push(`start-${message.rowId}`)

                    if (message.rowId === 1) {
                        await new Promise((resolve) => setTimeout(resolve, 20))
                    }

                    events.push(`end-${message.rowId}`)
                },
            },
        })

        await dispatcher.dispatch([createMessage(1), createMessage(2)])

        expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
    })

    it('routes DMs to onDirectMessage', async () => {
        const received: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onDirectMessage: (msg) => {
                    received.push(msg.rowId)
                },
            },
        })

        await dispatcher.dispatch([createMessage(1)])

        expect(received).toEqual([1])
    })

    it('routes group messages to onGroupMessage', async () => {
        const received: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onGroupMessage: (msg) => {
                    received.push(msg.rowId)
                },
            },
        })

        const groupMsg = { ...createMessage(1), chatKind: 'group' as const, chatId: 'iMessage;+;chat123' }
        await dispatcher.dispatch([groupMsg])

        expect(received).toEqual([1])
    })

    it('routes isFromMe messages to onFromMeMessage only, not onIncomingMessage/onDirect/onGroup', async () => {
        const incoming: number[] = []
        const direct: number[] = []
        const group: number[] = []
        const fromMe: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onIncomingMessage: (msg) => {
                    incoming.push(msg.rowId)
                },
                onDirectMessage: (msg) => {
                    direct.push(msg.rowId)
                },
                onGroupMessage: (msg) => {
                    group.push(msg.rowId)
                },
                onFromMeMessage: (msg) => {
                    fromMe.push(msg.rowId)
                },
            },
        })

        const fromMeDm = { ...createMessage(1), isFromMe: true }
        const fromMeGroup = {
            ...createMessage(2),
            isFromMe: true,
            chatKind: 'group' as const,
            chatId: 'iMessage;+;chat123',
        }
        await dispatcher.dispatch([fromMeDm, fromMeGroup])

        expect(incoming).toEqual([])
        expect(direct).toEqual([])
        expect(group).toEqual([])
        expect(fromMe).toEqual([1, 2])
    })

    it('partitions batches — incoming and from-me each reach their branch', async () => {
        const incoming: number[] = []
        const fromMe: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onIncomingMessage: (msg) => {
                    incoming.push(msg.rowId)
                },
                onFromMeMessage: (msg) => {
                    fromMe.push(msg.rowId)
                },
            },
        })

        await dispatcher.dispatch([
            createMessage(1),
            { ...createMessage(2), isFromMe: true },
            createMessage(3),
            { ...createMessage(4), isFromMe: true },
        ])

        expect(incoming).toEqual([1, 3])
        expect(fromMe).toEqual([2, 4])
    })

    it('chatKind="unknown" still reaches onIncomingMessage but neither onDirect nor onGroup', async () => {
        const incoming: number[] = []
        const direct: number[] = []
        const group: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onIncomingMessage: (msg) => {
                    incoming.push(msg.rowId)
                },
                onDirectMessage: (msg) => {
                    direct.push(msg.rowId)
                },
                onGroupMessage: (msg) => {
                    group.push(msg.rowId)
                },
            },
        })

        const unknownKind = { ...createMessage(7), chatKind: 'unknown' as const, chatId: null }
        await dispatcher.dispatch([unknownKind])

        expect(incoming).toEqual([7])
        expect(direct).toEqual([])
        expect(group).toEqual([])
    })

    it('forwards incoming messages to sink.onIncomingMessage (plugin integration)', async () => {
        const sinkIncoming: number[] = []
        const sinkFromMe: number[] = []
        const sinkErrors: string[] = []
        const dispatcher = new MessageDispatcher({
            sink: {
                onIncomingMessage: async (msg) => {
                    sinkIncoming.push(msg.rowId)
                },
                onFromMe: async (msg) => {
                    sinkFromMe.push(msg.rowId)
                },
                onError: (err) => {
                    sinkErrors.push(err.message)
                },
            },
        })

        await dispatcher.dispatch([createMessage(1), { ...createMessage(2), isFromMe: true }])

        expect(sinkIncoming).toEqual([1])
        expect(sinkFromMe).toEqual([2])
        expect(sinkErrors).toEqual([])
    })

    it('routes an onIncomingMessage user-callback throw through onError without breaking later messages', async () => {
        const errors: string[] = []
        const seen: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onIncomingMessage: (msg) => {
                    seen.push(msg.rowId)
                    if (msg.rowId === 1) throw new Error('handler blew up')
                },
                onError: (err) => {
                    errors.push(err.message)
                },
            },
        })

        await dispatcher.dispatch([createMessage(1), createMessage(2)])

        expect(seen).toEqual([1, 2])
        expect(errors).toEqual(['handler blew up'])
    })

    it('is a no-op for an empty batch', async () => {
        const seen: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onIncomingMessage: (msg) => {
                    seen.push(msg.rowId)
                },
                onFromMeMessage: (msg) => {
                    seen.push(msg.rowId)
                },
            },
        })

        await dispatcher.dispatch([])
        expect(seen).toEqual([])
    })

    it('an error in the from-me branch does not stop incoming dispatch', async () => {
        const incoming: number[] = []
        const errors: string[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onIncomingMessage: (msg) => {
                    incoming.push(msg.rowId)
                },
                onFromMeMessage: () => {
                    throw new Error('from-me blew up')
                },
                onError: (err) => {
                    errors.push(err.message)
                },
            },
        })

        await dispatcher.dispatch([createMessage(1), { ...createMessage(2), isFromMe: true }])

        expect(incoming).toEqual([1])
        expect(errors).toEqual(['from-me blew up'])
    })
})
