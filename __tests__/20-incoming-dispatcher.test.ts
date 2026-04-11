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
        isOffGridMessage: false,
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
                onMessage: async (message) => {
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

    it('skips isFromMe messages for event dispatch', async () => {
        const received: number[] = []
        const dispatcher = new MessageDispatcher({
            events: {
                onMessage: (msg) => {
                    received.push(msg.rowId)
                },
            },
        })

        const fromMe = { ...createMessage(1), isFromMe: true }
        await dispatcher.dispatch([fromMe])

        expect(received).toEqual([])
    })
})
