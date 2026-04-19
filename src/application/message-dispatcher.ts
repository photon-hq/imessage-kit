/**
 * Incoming message dispatcher.
 *
 * Routes batches of messages from the watch source to user callbacks
 * and plugin sinks.
 */

import { toError } from '../domain/errors'
import type { Message } from '../domain/message'

// -----------------------------------------------
// Port interfaces
// -----------------------------------------------

/**
 * Forwards observed messages to plugin hooks.
 *
 * Satisfied by infra's plugin manager via structural typing.
 *
 * - `onIncomingMessage` receives incoming (non-from-me) messages.
 * - `onFromMe` receives from-me messages the watcher observed in the DB,
 *   regardless of origin (this SDK, other clients, Messages.app UI).
 */
export interface MessageSink {
    onIncomingMessage(message: Message): Promise<void>
    onFromMe(message: Message): Promise<void>
    onError(error: Error, context: string): void
}

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Callback for handling a single message. */
export type MessageCallback = (message: Message) => void | Promise<void>

/** User-provided event handlers for watcher-observed messages. */
export interface DispatchEvents {
    /** Called for every incoming (non-from-me) message. */
    readonly onIncomingMessage?: MessageCallback
    /** Called for incoming direct (1-on-1) messages. */
    readonly onDirectMessage?: MessageCallback
    /** Called for incoming group messages. */
    readonly onGroupMessage?: MessageCallback
    /**
     * Called for every from-me message observed in the database, regardless
     * of origin (this SDK, other Apple clients, Messages.app UI).
     *
     * This is the authoritative source of "my send landed in chat.db" —
     * `sdk.send()` itself resolves on AppleScript dispatch and does not
     * wait for a chat.db row.
     */
    readonly onFromMeMessage?: MessageCallback
    /** Called when dispatch encounters an error. */
    readonly onError?: (error: Error) => void
}

/** Dispatcher construction options. */
export interface DispatchOptions {
    readonly events?: DispatchEvents
    readonly sink?: MessageSink
    readonly debug?: boolean
}

// -----------------------------------------------
// Dispatcher
// -----------------------------------------------

export class MessageDispatcher {
    private readonly events: DispatchEvents
    private readonly sink?: MessageSink
    private readonly debug: boolean

    constructor(options: DispatchOptions = {}) {
        this.events = options.events ?? {}
        this.sink = options.sink
        this.debug = options.debug ?? false
    }

    /**
     * Process a batch of messages from the watch source.
     *
     * Pipeline: partition by `isFromMe` → dispatch each branch in parallel.
     * Within a branch, messages are processed sequentially so ordering
     * inside the user's callback is preserved; the two branches are
     * independent, so a slow from-me handler never blocks incoming
     * delivery (and vice-versa).
     *
     * Serialization of batches is the watcher's contract — the consumer loop
     * awaits one dispatch before producing the next batch.
     */
    async dispatch(messages: readonly Message[]): Promise<void> {
        const incoming: Message[] = []
        const fromMe: Message[] = []
        for (const message of messages) {
            if (message.isFromMe) fromMe.push(message)
            else incoming.push(message)
        }

        await Promise.all([this.dispatchIncoming(incoming), this.dispatchFromMe(fromMe)])
    }

    /** Forward an external error to the sink and user callback. */
    handleError(error: unknown, context: string): void {
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

    private async dispatchIncoming(messages: readonly Message[]): Promise<void> {
        for (const message of messages) {
            try {
                await this.dispatchOneIncoming(message)
            } catch (error) {
                this.handleError(error, 'dispatch-message')
            }
        }
    }

    private async dispatchOneIncoming(message: Message): Promise<void> {
        await this.sink?.onIncomingMessage(message)
        await this.events.onIncomingMessage?.(message)

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

    private async dispatchFromMe(messages: readonly Message[]): Promise<void> {
        for (const message of messages) {
            try {
                await this.sink?.onFromMe(message)
                await this.events.onFromMeMessage?.(message)
            } catch (error) {
                this.handleError(error, 'dispatch-from-me')
            }
        }
    }
}
