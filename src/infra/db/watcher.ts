/**
 * WAL-based real-time message monitor.
 *
 * State machine:
 *   WAL exists     -> watch WAL file (change events trigger polling)
 *   WAL rotated    -> switch to directory watch (wait for WAL to reappear)
 *   WAL reappears  -> switch back to WAL watch
 *   Both fail      -> stop and report error
 *
 * Event merging:
 *   fs.watch may fire many events in rapid succession. A single-slot
 *   semaphore (trigger/waitForTrigger) coalesces bursts into one
 *   consumer loop wake-up.
 *
 * Unlinked senders:
 *   Messages.app can commit an incoming row a beat before it sets the row's
 *   handle, so the handle join yields `participant = null` for a message that
 *   does have a sender. The cursor stops at such a row (earlier rows still
 *   go out) and re-polls until the sender links, then emits it in order. A
 *   row still unlinked after `senderLinkGraceMs` is emitted as-is.
 */

import { type FSWatcher, watch } from 'node:fs'
import { basename, dirname } from 'node:path'

import { toError } from '../../domain/errors'
import type { Message } from '../../domain/message'
import type { MessageQuery } from '../../types/query'

// -----------------------------------------------
// Minimal database contract
// -----------------------------------------------

/** Minimal interface for the database reader consumed by the watcher. */
export interface WatchSourceDatabase {
    readonly getMessagesSinceRowId: (sinceRowId: number, query?: MessageQuery) => Promise<readonly Message[]>
    readonly getMaxRowId: () => Promise<number>
}

// -----------------------------------------------
// Types
// -----------------------------------------------

type WatchHandle = Pick<FSWatcher, 'close' | 'on'>

type WatchFactory = (
    path: string,
    listener: (eventType: 'change' | 'rename', filename?: string | Buffer | null) => void
) => WatchHandle

/** Configuration for the message watch source. */
export interface WatchSourceOptions {
    readonly database: WatchSourceDatabase
    readonly databasePath: string
    readonly watchFactory?: WatchFactory
    readonly onBatch?: (messages: readonly Message[]) => void | Promise<void>
    readonly onError?: (error: Error) => void
    readonly debug?: boolean
    /** How long an incoming row may wait for its sender to link before it is emitted as-is. */
    readonly senderLinkGraceMs?: number
}

// -----------------------------------------------
// Constants
// -----------------------------------------------

const BATCH_LIMIT = 100
const SENDER_LINK_GRACE_MS = 2_000
const SENDER_LINK_RECHECK_MS = 250

/** An incoming chat message whose sender's handle has not been linked yet. */
function awaitsSenderLink(message: Message): boolean {
    return !message.isFromMe && message.kind === 'text' && message.chatId !== null && message.participant === null
}

// -----------------------------------------------
// MessageWatchSource
// -----------------------------------------------

/** Monitors the Messages SQLite WAL file for real-time message detection. */
export class MessageWatchSource {
    private readonly database: WatchSourceDatabase
    private readonly databasePath: string
    private readonly walPath: string
    private readonly walFilename: string
    private readonly watchFactory: WatchFactory

    private readonly onBatch?: (messages: readonly Message[]) => void | Promise<void>
    private readonly onError?: (error: Error) => void
    private readonly debug: boolean
    private readonly senderLinkGraceMs: number

    private isRunning = false
    private lastRowId = -1

    /** The row the cursor is stopped at, waiting for its sender to link. */
    private held: { rowId: number; since: number } | null = null
    private recheckTimer: ReturnType<typeof setTimeout> | null = null

    private triggerResolve: (() => void) | null = null
    private hasPendingTrigger = false

    private walWatcher: WatchHandle | null = null
    private dirWatcher: WatchHandle | null = null

    /**
     * Handle to the running consumer loop. `stop()` awaits this to guarantee
     * that no `onBatch` (= plugin dispatch) is in flight after stop resolves —
     * otherwise plugin `onIncomingMessage` could race with SDK shutdown's
     * `onDestroy`, violating the documented lifecycle contract.
     */
    private consumePromise: Promise<void> | null = null

    constructor(options: WatchSourceOptions) {
        this.database = options.database
        this.databasePath = options.databasePath
        this.walPath = `${this.databasePath}-wal`
        this.walFilename = `${basename(this.databasePath)}-wal`
        this.watchFactory = options.watchFactory ?? ((path, listener) => watch(path, listener))

        this.onBatch = options.onBatch
        this.onError = options.onError
        this.debug = options.debug ?? false
        this.senderLinkGraceMs = options.senderLinkGraceMs ?? SENDER_LINK_GRACE_MS
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    /** Start watching for new messages. */
    async start(): Promise<void> {
        if (this.isRunning) return

        this.lastRowId = await this.database.getMaxRowId()
        this.isRunning = true

        try {
            this.ensureWatching()
            this.trigger()
            this.consumePromise = this.consumeLoop()
        } catch (error) {
            this.isRunning = false
            this.detachWALWatcher()
            this.detachDirWatcher()
            throw error
        }
    }

    /**
     * Stop watching and release all resources.
     *
     * Resolves only after the consumer loop has actually exited — any
     * `onBatch` in flight runs to completion first. This is the property
     * the SDK's `close()` relies on to avoid dispatching to plugins after
     * their `onDestroy` has already fired.
     */
    async stop(): Promise<void> {
        if (!this.isRunning && !this.consumePromise) return

        this.isRunning = false

        this.detachWALWatcher()
        this.detachDirWatcher()
        this.clearRecheck()
        this.held = null

        if (this.triggerResolve) {
            this.triggerResolve()
            this.triggerResolve = null
        }
        this.hasPendingTrigger = false

        const pending = this.consumePromise
        this.consumePromise = null
        if (pending) await pending
    }

    // -----------------------------------------------
    // Single-slot semaphore
    // -----------------------------------------------

    private trigger(): void {
        if (this.triggerResolve) {
            this.triggerResolve()
            this.triggerResolve = null
            return
        }
        this.hasPendingTrigger = true
    }

    private waitForTrigger(): Promise<void> {
        if (this.hasPendingTrigger) {
            this.hasPendingTrigger = false
            return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
            this.triggerResolve = resolve
        })
    }

    // -----------------------------------------------
    // Consumer loop
    // -----------------------------------------------

    private async consumeLoop(): Promise<void> {
        while (this.isRunning) {
            await this.waitForTrigger()
            if (!this.isRunning) break

            try {
                while (await this.processBatch()) {
                    if (!this.isRunning) break
                }
            } catch (error) {
                this.handleError(error)
            }
        }
    }

    private async processBatch(): Promise<boolean> {
        const fetched = await this.database.getMessagesSinceRowId(this.lastRowId, { limit: BATCH_LIMIT })
        const messages = this.releasable(fetched)

        if (messages.length > 0) {
            if (!this.isRunning) return false
            await this.onBatch?.(messages)
            const last = messages[messages.length - 1]
            if (last) this.lastRowId = last.rowId
        }

        return messages.length === BATCH_LIMIT
    }

    /**
     * The prefix of `fetched` that can be emitted now: everything before the
     * first row still waiting for its sender, or through it once its grace
     * period has run out.
     */
    private releasable(fetched: readonly Message[]): readonly Message[] {
        const index = fetched.findIndex(awaitsSenderLink)
        const waiting = fetched[index]
        if (!waiting) {
            this.held = null
            return fetched
        }

        if (this.held?.rowId !== waiting.rowId) this.held = { rowId: waiting.rowId, since: Date.now() }

        if (Date.now() - this.held.since >= this.senderLinkGraceMs) {
            if (this.debug) console.warn(`[WatchSource] sender never linked for ${waiting.id}; emitting without it`)
            this.held = null
            this.trigger()
            return fetched.slice(0, index + 1)
        }

        this.scheduleRecheck()
        return fetched.slice(0, index)
    }

    // The link is itself a WAL write, so it usually wakes the loop; the
    // timer covers a missed event and the grace deadline.
    private scheduleRecheck(): void {
        if (this.recheckTimer) return
        this.recheckTimer = setTimeout(
            () => {
                this.recheckTimer = null
                if (this.isRunning) this.trigger()
            },
            Math.min(SENDER_LINK_RECHECK_MS, this.senderLinkGraceMs)
        )
    }

    private clearRecheck(): void {
        if (!this.recheckTimer) return
        clearTimeout(this.recheckTimer)
        this.recheckTimer = null
    }

    // -----------------------------------------------
    // WAL / directory watcher state machine
    // -----------------------------------------------

    private ensureWatching(): void {
        this.attachWALWatcher()
        if (this.walWatcher) return

        try {
            this.attachDirWatcher()
        } catch (error) {
            const cause = toError(error)
            throw new Error(`Failed to start watcher: WAL missing and directory watch failed — ${cause.message}`, {
                cause,
            })
        }
    }

    private attachWALWatcher(): void {
        if (this.walWatcher) return

        try {
            const watcher = this.watchFactory(this.walPath, (eventType) => {
                if (eventType === 'change') {
                    this.trigger()
                } else if (eventType === 'rename') {
                    this.detachWALWatcher()
                    this.recoverOrStop('WAL file rotated')
                }
            })

            watcher.on('error', () => {
                this.detachWALWatcher()
                this.recoverOrStop('WAL watcher failed')
            })

            this.walWatcher = watcher
            this.detachDirWatcher()
        } catch (error) {
            // Only ENOENT is a legitimate fallback to dir-watch — the WAL
            // file hasn't been created yet. Everything else (EACCES, EMFILE,
            // …) is fatal and must surface.
            if (!isMissingFileError(error)) throw error
            if (this.debug) {
                console.warn('[WatchSource] WAL missing, falling back to dir watch')
            }
        }
    }

    private detachWALWatcher(): void {
        if (!this.walWatcher) return
        this.walWatcher.close()
        this.walWatcher = null
    }

    private attachDirWatcher(): void {
        if (this.dirWatcher) return

        const dir = dirname(this.databasePath)
        const watcher = this.watchFactory(dir, (_eventType, filename) => {
            const name =
                typeof filename === 'string' ? filename : Buffer.isBuffer(filename) ? filename.toString('utf8') : null

            if (name !== this.walFilename) return

            // attachWALWatcher throws on non-ENOENT fs errors (EACCES,
            // EMFILE, …). Route through handleError instead of letting
            // the throw escape the fs.watch callback — that would
            // surface as an uncaughtException and crash the host.
            try {
                this.attachWALWatcher()
                this.trigger()
            } catch (error) {
                this.handleError(error)
            }
        })

        watcher.on('error', () => {
            this.detachDirWatcher()
            this.recoverOrStop('Directory watcher failed')
        })

        this.dirWatcher = watcher
    }

    private detachDirWatcher(): void {
        if (!this.dirWatcher) return
        this.dirWatcher.close()
        this.dirWatcher = null
    }

    // -----------------------------------------------
    // Error handling
    // -----------------------------------------------

    private recoverOrStop(context: string): void {
        try {
            this.ensureWatching()
        } catch (error) {
            // Fire-and-forget: stop() is now async (awaits consumer loop),
            // but this runs inside an fs.watch callback where we can't await.
            // The error is reported immediately; the stop work completes in
            // the background.
            void this.stop()
            this.handleError(new Error(`${context}: ${toError(error).message}`))
        }
    }

    private handleError(error: unknown): void {
        const err = toError(error)

        if (this.debug) {
            console.error('[WatchSource] Error:', err)
        }

        try {
            this.onError?.(err)
        } catch (callbackError) {
            if (this.debug) {
                console.error('[WatchSource] Error handler failed:', toError(callbackError))
            }
        }
    }
}

// -----------------------------------------------
// Helpers
// -----------------------------------------------

function isMissingFileError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
}
