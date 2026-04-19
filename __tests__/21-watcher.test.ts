/**
 * MessageWatchSource — lifecycle + consume loop behaviour.
 *
 * Covered here:
 *   - startup reconcile (no startup window loss)
 *   - fatal start failure (no WAL + no dir watch)
 *   - recovery path failure surfaced via onError + isRunning flipped off
 *   - processBatch pagination (keep looping while result size == BATCH_LIMIT)
 *   - lastRowId monotonicity across batches
 *   - onBatch invocations are sequential, never overlapped
 *   - stop() awaits an in-flight onBatch before resolving
 *
 * UPDATE observation (edit/retract) is intentionally NOT covered here —
 * see 22-watcher-updates.test.ts for the documented gap.
 */

import { describe, expect, it } from 'bun:test'
import type { Message } from '../src/domain/message'
import { createSpy, waitFor } from './setup'

// -----------------------------------------------
// Helpers
// -----------------------------------------------

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

const BATCH_LIMIT = 100

// -----------------------------------------------
// Lifecycle
// -----------------------------------------------

describe('MessageWatchSource — lifecycle', () => {
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
        expect(getMessagesSinceRowId.calls[0]?.args[0]).toBe(2)
        expect(getMessagesSinceRowId.calls[0]?.args[1]).toEqual({ limit: BATCH_LIMIT })
        expect(onBatch.calls[0]?.args[0].map((m: Message) => m.rowId)).toEqual([3])

        await source.stop()
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
                const err = new Error('ENOENT: file not found') as Error & { code: string }
                err.code = 'ENOENT'
                throw err
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
                    const err = new Error('ENOENT: wal missing') as Error & { code: string }
                    err.code = 'ENOENT'
                    throw err
                }

                if (watchAttempts === 2) {
                    return dirWatcher
                }

                const err = new Error('ENOENT: watch unavailable') as Error & { code: string }
                err.code = 'ENOENT'
                throw err
            },
        })

        await source.start()
        dirWatcher.emitError()

        await waitFor(() => onError.callCount() === 1, 500)

        expect(onError.calls[0]?.args[0].message).toContain('Directory watcher failed')
        expect((source as unknown as { isRunning: boolean }).isRunning).toBe(false)
    })
})

// -----------------------------------------------
// Consume loop
// -----------------------------------------------

describe('MessageWatchSource — consume loop', () => {
    it('keeps polling while the result is exactly BATCH_LIMIT (pagination) and stops at < BATCH_LIMIT', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        // Simulate 250 backlog rows. First two polls return 100 each, third
        // returns 50 (below the limit) — the consume loop must drain all three
        // in a single trigger.
        let cursor = 0
        const all = Array.from({ length: 250 }, (_, i) => createMessage(i + 1))
        const getMessagesSinceRowId = createSpy(async (sinceRowId: number, query: { limit: number }) => {
            const start = all.findIndex((m) => m.rowId > sinceRowId)
            const slice = start === -1 ? [] : all.slice(start, start + query.limit)
            cursor = slice.length
            return slice
        })
        const onBatch = createSpy(async () => {})

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId: getMessagesSinceRowId.fn,
            },
            databasePath: '/tmp/chat.db',
            onBatch: onBatch.fn,
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        await waitFor(() => onBatch.callCount() >= 3, 500)

        expect(onBatch.callCount()).toBe(3)
        expect(onBatch.calls[0]?.args[0].length).toBe(100)
        expect(onBatch.calls[1]?.args[0].length).toBe(100)
        expect(onBatch.calls[2]?.args[0].length).toBe(50)

        await source.stop()
        void cursor // silence unused
    })

    it('advances lastRowId monotonically across consecutive batches', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        const sinceRowIds: number[] = []
        let call = 0
        const getMessagesSinceRowId = createSpy(async (sinceRowId: number) => {
            sinceRowIds.push(sinceRowId)
            call += 1
            if (call === 1) return [createMessage(5), createMessage(6)]
            if (call === 2) return [createMessage(10)]
            return []
        })

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 4,
                getMessagesSinceRowId: getMessagesSinceRowId.fn,
            },
            databasePath: '/tmp/chat.db',
            onBatch: async () => {},
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        // Force a second trigger by calling a second reconcile via the internal
        // trigger — we simulate the WAL fs.watch 'change' event producing one.
        await waitFor(() => sinceRowIds.length >= 1, 500)
        ;(source as unknown as { trigger(): void }).trigger()
        await waitFor(() => sinceRowIds.length >= 2, 500)

        // First poll starts from max-rowid baseline (4); second starts from the
        // last delivered rowId (6), proving lastRowId advanced.
        expect(sinceRowIds[0]).toBe(4)
        expect(sinceRowIds[1]).toBe(6)

        await source.stop()
    })

    it('invokes onBatch sequentially — never begins the next poll before the previous handler resolves', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        let inFlight = 0
        let maxInFlight = 0
        const onBatch = async () => {
            inFlight += 1
            maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise((r) => setTimeout(r, 15))
            inFlight -= 1
        }

        let call = 0
        const getMessagesSinceRowId = async () => {
            call += 1
            if (call === 1) return [createMessage(1)]
            if (call === 2) return [createMessage(2)]
            return []
        }

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId,
            },
            databasePath: '/tmp/chat.db',
            onBatch,
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        ;(source as unknown as { trigger(): void }).trigger()

        await waitFor(() => call >= 2 && inFlight === 0, 500)

        expect(maxInFlight).toBe(1)

        await source.stop()
    })

    it('stop() waits for the in-flight onBatch to finish before resolving', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        let onBatchResolved = false
        const onBatch = async () => {
            await new Promise((r) => setTimeout(r, 40))
            onBatchResolved = true
        }

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId: async () => [createMessage(1)],
            },
            databasePath: '/tmp/chat.db',
            onBatch,
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        // Wait until the consumer definitely entered onBatch.
        await waitFor(() => onBatchResolved === false && source !== null, 30)

        await source.stop()
        // Post-stop, the in-flight handler must have finished.
        expect(onBatchResolved).toBe(true)
    })

    it('routes batch-processing errors through onError without crashing the loop', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        const onError = createSpy((e: Error) => e)
        let call = 0
        const getMessagesSinceRowId = async () => {
            call += 1
            if (call === 1) throw new Error('db read boom')
            return []
        }

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId,
            },
            databasePath: '/tmp/chat.db',
            onError: onError.fn,
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        await waitFor(() => onError.callCount() >= 1, 500)

        expect(onError.calls[0]?.args[0].message).toContain('db read boom')
        expect((source as unknown as { isRunning: boolean }).isRunning).toBe(true)

        await source.stop()
    })
})
