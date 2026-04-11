import { describe, expect, it } from 'bun:test'
import type { Message } from '../src/domain/message'
import { createSpy, waitFor } from './setup'

type WatchErrorListener = () => void

function createWatchHandle() {
    let onError: WatchErrorListener | undefined

    return {
        close() {},
        on(event: string, listener: WatchErrorListener) {
            if (event === 'error') {
                onError = listener
            }

            return this
        },
        emitError() {
            onError?.()
        },
    }
}

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

describe('MessageWatchSource', () => {
    it('runs an immediate reconcile after start to avoid missing startup-window messages', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        const getMessagesSinceRowId = createSpy(async () => [createMessage(3)])
        const onBatch = createSpy(async () => {})
        const database = {
            getMaxRowId: async () => 2,
            getMessagesSinceRowId: getMessagesSinceRowId.fn,
        }

        const source = new MessageWatchSource({
            database,
            databasePath: '/tmp/chat.db',
            onBatch: onBatch.fn,
            watchFactory: () => createWatchHandle(),
        })

        await source.start()

        await waitFor(() => onBatch.callCount() === 1, 500)

        expect(getMessagesSinceRowId.callCount()).toBeGreaterThan(0)
        // The watcher calls getMessagesSinceRowId(sinceRowId, { limit: BATCH_LIMIT })
        expect(getMessagesSinceRowId.calls[0]?.args[0]).toBe(2)
        expect(getMessagesSinceRowId.calls[0]?.args[1]).toEqual({ limit: 100 })
        expect(onBatch.calls[0]?.args[0].map((message: Message) => message.rowId)).toEqual([3])

        source.stop()
    })

    it('fails start when neither WAL watch nor directory watch can be established', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')
        const database = {
            getMaxRowId: async () => 0,
            getMessagesSinceRowId: async () => [],
        }

        const source = new MessageWatchSource({
            database,
            databasePath: '/tmp/chat.db',
            watchFactory: () => {
                throw new Error('watch unavailable')
            },
        })

        await expect(source.start()).rejects.toThrow('Failed to start watcher')
    })

    it('stops and reports an error when watcher recovery cannot re-establish monitoring', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')
        const dirWatcher = createWatchHandle()
        const onError = createSpy((error: Error) => error)
        let watchAttempts = 0

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId: async () => [],
            },
            databasePath: '/tmp/chat.db',
            onError: onError.fn,
            watchFactory: () => {
                watchAttempts += 1

                if (watchAttempts === 1) {
                    throw new Error('wal missing')
                }

                if (watchAttempts === 2) {
                    return dirWatcher
                }

                throw new Error('watch unavailable')
            },
        })

        await source.start()
        dirWatcher.emitError()

        await waitFor(() => onError.callCount() === 1, 500)

        expect(onError.calls[0]?.args[0].message).toContain('Directory watcher failed')
        expect((source as unknown as { isRunning: boolean }).isRunning).toBe(false)
    })
})
