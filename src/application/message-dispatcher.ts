/**
 * Incoming message dispatcher.
 *
 * Routes batches of messages from the watch source to user callbacks
 * and plugin sinks. Reconciles outgoing sends with database confirmations.
 */

import { toError } from '../domain/errors'
import type { Message } from '../domain/message'

// -----------------------------------------------
// Port interfaces
// -----------------------------------------------

/**
 * Matches outgoing sends against database-confirmed messages.
 *
 * Satisfied by infra's outgoing tracker via structural typing.
 */
export interface OutgoingMatcher {
    /** Attempt to match a from-me message to a pending send. */
    tryMatch(message: Message): boolean
    /** Remove resolved and expired entries. */
    cleanup(): void
}

/**
 * Forwards incoming messages to plugin hooks.
 *
 * Satisfied by infra's plugin manager via structural typing.
 */
export interface MessageSink {
    onMessage(message: Message): Promise<void>
    onError(error: Error, context: string): void
}

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Callback for handling a single message. */
export type MessageCallback = (message: Message) => void | Promise<void>

/** User-provided event handlers for incoming messages. */
export interface DispatchEvents {
    /** Called for every incoming message. */
    readonly onMessage?: MessageCallback
    /** Called for direct (1-on-1) messages. */
    readonly onDirectMessage?: MessageCallback
    /** Called for group messages. */
    readonly onGroupMessage?: MessageCallback
    /** Called when dispatch encounters an error. */
    readonly onError?: (error: Error) => void
}

/** Dispatcher construction options. */
export interface DispatchOptions {
    readonly events?: DispatchEvents
    readonly sink?: MessageSink
    readonly outgoingMatcher?: OutgoingMatcher
    readonly debug?: boolean
}

// -----------------------------------------------
// Dispatcher
// -----------------------------------------------

export class MessageDispatcher {
    private readonly events: DispatchEvents
    private readonly sink?: MessageSink
    private readonly outgoingMatcher?: OutgoingMatcher
    private readonly debug: boolean
    private dispatching = false

    constructor(options: DispatchOptions = {}) {
        this.events = options.events ?? {}
        this.sink = options.sink
        this.outgoingMatcher = options.outgoingMatcher
        this.debug = options.debug ?? false
    }

    /**
     * Process a batch of messages from the watch source.
     *
     * Pipeline: reconcile outgoing → filter isFromMe → dispatch to sink + events.
     *
     * Must not be called concurrently. The watcher must await the previous
     * dispatch before calling again.
     */
    async dispatch(messages: readonly Message[]): Promise<void> {
        if (this.dispatching) {
            throw new Error('dispatch() must not be called concurrently')
        }
        this.dispatching = true

        try {
            this.reconcileOutgoing(messages)

            const incoming = messages.filter((m) => !m.isFromMe)
            await this.dispatchAll(incoming)

            this.outgoingMatcher?.cleanup()
        } finally {
            this.dispatching = false
        }
    }

    /** Forward an external error to the sink and user callback. */
    handleError(error: unknown, context = 'dispatcher'): void {
        const err = toError(error)

        if (this.debug) {
            console.error(`[MessageDispatcher] ${context}:`, err)
        }

        this.sink?.onError(err, context)
        this.events.onError?.(err)
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private reconcileOutgoing(messages: readonly Message[]): void {
        if (!this.outgoingMatcher) return

        for (const message of messages) {
            if (!message.isFromMe) continue
            this.outgoingMatcher.tryMatch(message)
        }
    }

    private async dispatchAll(messages: readonly Message[]): Promise<void> {
        for (const message of messages) {
            try {
                await this.dispatchOne(message)
            } catch (error) {
                this.handleError(error, 'dispatch-message')
            }
        }
    }

    private async dispatchOne(message: Message): Promise<void> {
        await this.sink?.onMessage(message)
        await this.events.onMessage?.(message)

        switch (message.chatKind) {
            case 'group':
                await this.events.onGroupMessage?.(message)
                break

            case 'dm':
                await this.events.onDirectMessage?.(message)
                break

            case 'unknown':
                // No routing assumption for unknown chat kinds
                break
        }
    }
}
