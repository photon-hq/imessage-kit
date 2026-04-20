/**
 * Watcher gap — UPDATE (edit / retract) observation.
 *
 * macOS 26 writes edits and unsends to the SAME message row:
 *   - edit:    `date_edited` is set, text is rewritten, rowid unchanged
 *   - retract: `is_empty = 1`, `message_summary_info` carries the Tahoe
 *              bplist with the `Rrp` marker, rowid unchanged
 *
 * `MessageWatchSource` polls with `getMessagesSinceRowId(lastRowId)` — once
 * a row has been delivered, its rowid is <= lastRowId and the filter
 * permanently excludes it. This file pins down that current behaviour so
 * the gap is obvious when anyone re-designs the watcher to surface UPDATE
 * events (e.g. by additionally polling `date_edited` / `is_empty`
 * transitions).
 *
 * When the SDK adds UPDATE observation, the tests in this file should
 * FLIP: `.toBe(1)` → `.toBeGreaterThan(1)` and the skipped expectation
 * should land.
 */

import { describe, expect, it } from 'bun:test'
import type { Message } from '../src/domain/message'
import { createSpy, waitFor } from './setup'

function createMessage(rowId: number, overrides: Partial<Message> = {}): Message {
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
        ...overrides,
    }
}

function createWatchHandle() {
    return {
        close() {},
        on() {
            return this
        },
    }
}

describe('Watcher — UPDATE observation gap (macOS 26 edit/retract)', () => {
    it('delivers an INSERTed row exactly once and NOT again after a subsequent edit UPDATE', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        // The "database" owns a single rowid=5 row. On the first poll it
        // returns the pristine row; on the second poll (after the simulated
        // UPDATE), the row carries a non-null `editedAt` but its rowid is
        // unchanged — so `getMessagesSinceRowId(5)` returns [] because the
        // row is no longer > sinceRowId.
        let edited = false
        let call = 0
        const onBatch = createSpy(async () => {})
        const getMessagesSinceRowId = async (sinceRowId: number) => {
            call += 1
            // Insert wave: rowid 5 passes the sinceRowId=0 filter.
            if (sinceRowId < 5) {
                return [createMessage(5)]
            }
            // Post-edit wave: rowid 5 would now have editedAt set, but
            // sinceRowId=5 filters it out. This is the gap.
            if (edited) {
                // If future code starts surfacing UPDATE'd rows through a
                // separate path, swap this return for the updated message —
                // but for the current contract, the reader still excludes it.
                return []
            }
            return []
        }

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId,
            },
            databasePath: '/tmp/chat.db',
            onBatch: onBatch.fn,
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        await waitFor(() => onBatch.callCount() >= 1, 500)

        // Simulate the UPDATE writing a date_edited into the same rowid.
        edited = true
        ;(source as unknown as { trigger(): void }).trigger()
        await waitFor(() => call >= 2, 500)

        // PINNED behaviour: one delivery, no second callback for the edit.
        expect(onBatch.callCount()).toBe(1)
        expect(onBatch.calls[0]?.args[0][0].rowId).toBe(5)

        await source.stop()
    })

    it('delivers an INSERTed row once and NOT again after a subsequent retract UPDATE (is_empty=1 + Rrp)', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        const onBatch = createSpy(async () => {})
        let call = 0
        const getMessagesSinceRowId = async (sinceRowId: number) => {
            call += 1
            if (sinceRowId < 9) return [createMessage(9)]
            // After the retract, rowid 9 would carry `retractedAt` but is
            // still not > sinceRowId → reader excludes it. This test pins
            // the fact that watcher never dispatches a retract event today.
            return []
        }

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId,
            },
            databasePath: '/tmp/chat.db',
            onBatch: onBatch.fn,
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        await waitFor(() => onBatch.callCount() >= 1, 500)

        // Simulated retract — trigger another poll cycle.
        ;(source as unknown as { trigger(): void }).trigger()
        await waitFor(() => call >= 2, 500)

        expect(onBatch.callCount()).toBe(1)
        expect(onBatch.calls[0]?.args[0][0].rowId).toBe(9)

        await source.stop()
    })

    it('lastRowId monotonically advances past the UPDATE row, permanently excluding it', async () => {
        const { MessageWatchSource } = await import('../src/infra/db/watcher')

        const seenSince: number[] = []
        let call = 0
        const getMessagesSinceRowId = async (sinceRowId: number) => {
            seenSince.push(sinceRowId)
            call += 1
            if (call === 1) return [createMessage(7)]
            return []
        }

        const source = new MessageWatchSource({
            database: {
                getMaxRowId: async () => 0,
                getMessagesSinceRowId,
            },
            databasePath: '/tmp/chat.db',
            onBatch: async () => {},
            watchFactory: () => createWatchHandle(),
        })

        await source.start()
        await waitFor(() => call >= 1, 500)
        ;(source as unknown as { trigger(): void }).trigger()
        await waitFor(() => call >= 2, 500)

        // First poll starts from max-rowid baseline 0; second starts from the
        // last delivered rowId (7). Any future UPDATE to rowid 7 is now
        // filtered out — the reader never revisits <= lastRowId rows.
        expect(seenSince[0]).toBe(0)
        expect(seenSince[1]).toBe(7)

        await source.stop()
    })
})
