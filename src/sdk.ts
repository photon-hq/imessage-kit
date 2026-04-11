/**
 * IMessageSDK — composition root.
 *
 * Wires domain, application, and infrastructure layers into a
 * single public API. All external dependencies are resolved here.
 */

import { MessageChain } from './application/message-chain'
import { type DispatchEvents, MessageDispatcher } from './application/message-dispatcher'
import type { SendContent, SendPort, SendRequest, SendResult } from './application/send-port'
import type { Chat } from './domain/chat'
import { ConfigError, toError } from './domain/errors'
import type { Message } from './domain/message'
import { MessagesDatabaseReader } from './infra/db/reader'
import { MessageWatchSource } from './infra/db/watcher'
import { MessageSender } from './infra/outgoing/sender'
import { TempFileManager } from './infra/outgoing/temp-files'
import { OutgoingMessageManager } from './infra/outgoing/tracker'
import { getDefaultDatabasePath, requireMacOS } from './infra/platform'
import { createPluginMessageSink, PluginManager } from './infra/plugin/manager'
import { BOUNDS } from './sdk-bounds'
import type { IMessageConfig } from './types/config'
import type { Plugin } from './types/plugin'
import type { ChatQuery, MessageQuery } from './types/query'
import { Semaphore } from './utils/async'

// -----------------------------------------------
// Constants
// -----------------------------------------------

const ERROR_SDK_DESTROYED = 'SDK is destroyed'
const ERROR_WATCHER_RUNNING = 'Watcher is already running'

// -----------------------------------------------
// Batch types
// -----------------------------------------------

/** A single item in a batch send. */
export interface SendBatchItem extends SendContent {
    readonly to: string
}

/** Result of a single batch item. */
export interface SendBatchItemResult {
    readonly to: string
    readonly status: 'sent' | 'failed' | 'skipped'
    readonly result?: SendResult
    readonly error?: Error
}

/** Options for batch send operations. */
export interface SendBatchOptions {
    /** Max concurrent sends for this batch. Effective limit is min(concurrency, maxConcurrentSends). */
    readonly concurrency?: number
    readonly continueOnError?: boolean
    readonly signal?: AbortSignal
}

/** Aggregated result of a batch send. */
export interface SendBatchResult {
    readonly results: readonly SendBatchItemResult[]
    readonly sent: number
    readonly failed: number
    readonly skipped: number
}

// -----------------------------------------------
// Watcher events
// -----------------------------------------------

/** Events for the message watcher. Extends dispatcher events with checkpoint. */
export interface WatcherEvents extends DispatchEvents {
    readonly onCheckpoint?: (checkTime: Date) => void
}

// -----------------------------------------------
// IMessageSDK
// -----------------------------------------------

export class IMessageSDK implements SendPort {
    private readonly databasePath: string
    private readonly debug: boolean
    private readonly maxConcurrentSends: number

    private readonly database: MessagesDatabaseReader
    private readonly tempFiles: TempFileManager
    private readonly sender: MessageSender
    private readonly plugins: PluginManager
    private readonly outgoing: OutgoingMessageManager
    private readonly abortController = new AbortController()

    private watchSource: MessageWatchSource | null = null
    private destroyed = false

    constructor(config: IMessageConfig = {}) {
        requireMacOS()

        this.databasePath = config.databasePath ?? getDefaultDatabasePath()
        this.debug = config.debug ?? false
        this.maxConcurrentSends = validateBound(
            config.maxConcurrentSends,
            BOUNDS.maxConcurrentSends,
            'maxConcurrentSends'
        )

        this.database = new MessagesDatabaseReader(this.databasePath)
        this.outgoing = new OutgoingMessageManager(this.debug)
        this.plugins = new PluginManager()

        const semaphore = new Semaphore(this.maxConcurrentSends)

        this.sender = new MessageSender({
            outgoingManager: this.outgoing,
            semaphore,
            debug: this.debug,
        })

        this.tempFiles = new TempFileManager({ debug: this.debug })
        this.tempFiles.start()

        if (config.plugins) {
            for (const plugin of config.plugins) {
                this.plugins.use(plugin)
            }
        }

        if (this.debug) {
            console.log('[SDK] Initialized')
        }
    }

    // -----------------------------------------------
    // Plugin Management
    // -----------------------------------------------

    /** Register a plugin. Late registrations are auto-initialized. */
    use(plugin: Plugin): this {
        this.assertAlive()
        this.plugins.use(plugin)
        return this
    }

    // -----------------------------------------------
    // Message Queries
    // -----------------------------------------------

    /** Query messages with optional filters. */
    async getMessages(query: MessageQuery = {}): Promise<readonly Message[]> {
        this.assertAlive()
        await this.plugins.init()

        await this.plugins.callHook('onBeforeMessageQuery', { query })
        const messages = await this.database.getMessages(query)
        await this.plugins.callHook('onAfterMessageQuery', { query, messages })

        return messages
    }

    /** List chats with optional filters and sorting. */
    async listChats(query: ChatQuery = {}): Promise<readonly Chat[]> {
        this.assertAlive()
        await this.plugins.init()

        await this.plugins.callHook('onBeforeChatQuery', { query })
        const chats = await this.database.listChats(query)
        await this.plugins.callHook('onAfterChatQuery', { query, chats })

        return chats
    }

    // -----------------------------------------------
    // Message Sending
    // -----------------------------------------------

    /** Send a message. Accepts either a SendRequest or (to, content) pair. */
    async send(request: SendRequest): Promise<SendResult>
    async send(to: string, content: string | SendContent): Promise<SendResult>
    async send(toOrRequest: string | SendRequest, content?: string | SendContent): Promise<SendResult> {
        this.assertAlive()

        const request = normalizeToSendRequest(toOrRequest, content)
        return this.executeSend(request)
    }

    /** Send a file attachment with optional text. */
    async sendFile(to: string, filePath: string, text?: string): Promise<SendResult> {
        return this.send({ to, text, attachments: [filePath] })
    }

    /** Send multiple file attachments with optional text. */
    async sendFiles(to: string, filePaths: readonly string[], text?: string): Promise<SendResult> {
        return this.send({ to, text, attachments: filePaths })
    }

    /** Send messages to multiple recipients with concurrency control. */
    async sendBatch(items: readonly SendBatchItem[], options: SendBatchOptions = {}): Promise<SendBatchResult> {
        this.assertAlive()
        await this.plugins.init()

        const { continueOnError = true, signal } = options
        const concurrency = options.concurrency ?? this.maxConcurrentSends
        const semaphore = new Semaphore(Math.max(1, concurrency))
        const batchAbort = composeAbortSignals(this.abortController.signal, signal)

        const results: SendBatchItemResult[] = new Array(items.length)
        let stopError: Error | null = null

        await Promise.all(
            items.map((item, index) =>
                semaphore
                    .run(async () => {
                        if (stopError) {
                            results[index] = { to: item.to, status: 'skipped', error: stopError }
                            return
                        }

                        try {
                            const result = await this.executeSend({
                                to: item.to,
                                text: item.text,
                                attachments: item.attachments,
                                signal: batchAbort,
                            })
                            results[index] = { to: item.to, status: 'sent', result }
                        } catch (error) {
                            const err = toError(error)
                            results[index] = { to: item.to, status: 'failed', error: err }

                            if (!continueOnError) {
                                stopError = err
                            }
                        }
                    }, batchAbort)
                    .catch((error) => {
                        results[index] = {
                            to: item.to,
                            status: stopError ? 'skipped' : 'failed',
                            error: stopError ?? toError(error),
                        }
                    })
            )
        )

        return {
            results,
            sent: results.filter((r) => r.status === 'sent').length,
            failed: results.filter((r) => r.status === 'failed').length,
            skipped: results.filter((r) => r.status === 'skipped').length,
        }
    }

    private async executeSend(request: SendRequest): Promise<SendResult> {
        this.assertAlive()
        await this.plugins.init()

        await this.plugins.callHook('onBeforeSend', { request })

        const signal = composeAbortSignals(this.abortController.signal, request.signal)
        const result = await this.sender.send({ ...request, signal })

        await this.plugins.callHook('onAfterSend', { request, result })

        return result
    }

    // -----------------------------------------------
    // Chain Processing
    // -----------------------------------------------

    /** Create a fluent processing chain for a message. */
    message(message: Message): MessageChain {
        this.assertAlive()
        return new MessageChain(message, this)
    }

    // -----------------------------------------------
    // Watcher
    // -----------------------------------------------

    /** Start watching for new messages in real time. */
    async startWatching(events: WatcherEvents = {}): Promise<void> {
        this.assertAlive()
        if (this.watchSource) throw new Error(ERROR_WATCHER_RUNNING)

        await this.plugins.init()

        const dispatcher = new MessageDispatcher({
            events,
            sink: createPluginMessageSink(this.plugins),
            outgoingMatcher: this.outgoing,
            debug: this.debug,
        })

        const watcher = new MessageWatchSource({
            database: this.database,
            databasePath: this.databasePath,
            onBatch: (messages) => dispatcher.dispatch(messages),
            onCheckpoint: events.onCheckpoint,
            onError: (error) => dispatcher.handleError(error, 'watch-source'),
            debug: this.debug,
        })

        try {
            await watcher.start()
            this.watchSource = watcher
        } catch (error) {
            watcher.stop()
            throw error
        }
    }

    /** Stop watching for new messages. */
    stopWatching(): void {
        this.watchSource?.stop()
        this.watchSource = null
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    /** Gracefully shut down the SDK and release all resources. */
    async close(): Promise<void> {
        if (this.destroyed) return
        this.destroyed = true

        const errors: Array<{ component: string; error: Error }> = []

        this.abortController.abort(new Error('SDK closed'))

        safeRun(errors, 'watchSource', () => {
            this.watchSource?.stop()
            this.watchSource = null
        })

        safeRun(errors, 'outgoingManager', () => {
            this.outgoing.rejectAll('SDK closed')
        })

        await safeRunAsync(errors, 'pluginManager', () => this.plugins.destroy())
        await safeRunAsync(errors, 'tempFileManager', () => this.tempFiles.destroy())

        safeRun(errors, 'database', () => {
            this.database.close()
        })

        if (errors.length > 0) {
            if (this.debug) {
                console.error('[SDK] Shutdown errors:', errors)
            }

            throw new AggregateError(
                errors.map((e) => e.error),
                `SDK shutdown failed: ${errors.map((e) => e.component).join(', ')}`
            )
        }
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close()
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private assertAlive(): void {
        if (this.destroyed) throw new Error(ERROR_SDK_DESTROYED)
    }
}

// -----------------------------------------------
// Pure helpers
// -----------------------------------------------

function validateBound(
    value: number | undefined,
    bound: { readonly default: number; readonly min: number; readonly max: number },
    name: string
): number {
    const resolved = value ?? bound.default

    if (resolved < bound.min || resolved > bound.max) {
        throw ConfigError(`${name} must be between ${bound.min} and ${bound.max}, got ${resolved}`)
    }

    return resolved
}

function normalizeToSendRequest(toOrRequest: string | SendRequest, content?: string | SendContent): SendRequest {
    if (typeof toOrRequest !== 'string') {
        return toOrRequest
    }

    if (content == null) {
        throw new Error('send() requires content when called with a target string')
    }

    if (typeof content === 'string') {
        return { to: toOrRequest, text: content }
    }

    return { to: toOrRequest, ...content }
}

function composeAbortSignals(...signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal | undefined {
    const active = signals.filter((s): s is AbortSignal => s != null)

    if (active.length === 0) return undefined
    if (active.length === 1) return active[0]

    return AbortSignal.any(active)
}

function safeRun(errors: Array<{ component: string; error: Error }>, component: string, fn: () => void): void {
    try {
        fn()
    } catch (error) {
        errors.push({ component, error: toError(error) })
    }
}

async function safeRunAsync(
    errors: Array<{ component: string; error: Error }>,
    component: string,
    fn: () => Promise<void>
): Promise<void> {
    try {
        await fn()
    } catch (error) {
        errors.push({ component, error: toError(error) })
    }
}
