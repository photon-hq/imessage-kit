/**
 * IMessageSDK — composition root.
 *
 * Wires domain, application, and infrastructure layers into a
 * single public API. All external dependencies are resolved here.
 */

import { type DispatchEvents, MessageDispatcher } from './application/message-dispatcher'
import type { SendPort } from './application/send-port'
import type { Chat } from './domain/chat'
import { ConfigError, toError } from './domain/errors'
import type { Message } from './domain/message'
import { MessagesDatabaseReader } from './infra/db/reader'
import { MessageWatchSource } from './infra/db/watcher'
import { MessageSender } from './infra/outgoing/sender'
import { TempFileManager } from './infra/outgoing/temp-files'
import { getDefaultDatabasePath, requireMacOS } from './infra/platform'
import { createPluginMessageSink, PluginManager } from './infra/plugin'
import { BOUNDS } from './sdk-bounds'
import type { IMessageConfig } from './types/config'
import type { Plugin } from './types/plugin'
import type { ChatQuery, MessageQuery } from './types/query'
import type { SendRequest } from './types/send'
import { Semaphore } from './utils/async'

// -----------------------------------------------
// Constants
// -----------------------------------------------

const ERROR_SDK_DESTROYED = 'SDK is destroyed'
const ERROR_WATCHER_RUNNING = 'Watcher is already running'

/**
 * Per-component shutdown failure captured by `safeRun`.
 *
 * `close()` must run every teardown even if an earlier one throws — a single
 * plugin.onDestroy failure must not leak the database handle or temp-file
 * timer. Each step is wrapped in `safeRun`, which pushes `{component, error}`
 * instead of rethrowing; `doClose` then collects all captures into one
 * `AggregateError` so the caller sees every failure, not just the first.
 */
type ShutdownError = { readonly component: string; readonly error: Error }

// -----------------------------------------------
// IMessageSDK
// -----------------------------------------------

export class IMessageSDK implements SendPort {
    private readonly databasePath: string
    private readonly debug: boolean

    private readonly database: MessagesDatabaseReader
    private readonly tempFiles: TempFileManager
    private readonly sender: MessageSender
    private readonly plugins: PluginManager
    private readonly abortController = new AbortController()

    private watchSource: MessageWatchSource | null = null
    private destroyed = false
    private closePromise: Promise<void> | null = null

    constructor(config: IMessageConfig = {}) {
        requireMacOS()

        this.databasePath = config.databasePath ?? getDefaultDatabasePath()
        this.debug = config.debug ?? false

        const maxConcurrentSends = validateBound(
            config.maxConcurrentSends,
            BOUNDS.maxConcurrentSends,
            'maxConcurrentSends'
        )

        const sendTimeout = validateBound(config.sendTimeout, BOUNDS.sendTimeout, 'sendTimeout')

        this.database = new MessagesDatabaseReader(this.databasePath)
        this.plugins = new PluginManager()

        const semaphore = new Semaphore(maxConcurrentSends)

        this.sender = new MessageSender({
            semaphore,
            debug: this.debug,
            timeout: sendTimeout,
            signal: this.abortController.signal,
        })

        this.tempFiles = new TempFileManager({ debug: this.debug })
        this.tempFiles.start()

        if (config.plugins) {
            for (const plugin of config.plugins) {
                this.plugins.use(plugin)
            }
        }

        if (this.debug) {
            const pluginCount = config.plugins?.length ?? 0
            console.log(
                `[SDK] Initialized: db=${this.databasePath} plugins=${pluginCount} ` +
                    `maxConcurrentSends=${maxConcurrentSends} sendTimeout=${sendTimeout}ms`
            )
        }
    }

    // -----------------------------------------------
    // Plugin Management
    // -----------------------------------------------

    /** Register a plugin. Late registrations are auto-initialized. */
    use(plugin: Plugin): this {
        this.assertNotDestroyed()
        this.plugins.use(plugin)
        return this
    }

    // -----------------------------------------------
    // Message Queries
    // -----------------------------------------------

    /** Query messages with optional filters. */
    async getMessages(query: MessageQuery = {}): Promise<readonly Message[]> {
        this.assertNotDestroyed()
        await this.plugins.init()

        await this.plugins.callInterruptingHook('onBeforeMessageQuery', 'DATABASE', { query })
        const messages = await this.database.getMessages(query)
        await this.plugins.callHook('onAfterMessageQuery', { query, messages })

        return messages
    }

    /** List chats with optional filters and sorting. */
    async listChats(query: ChatQuery = {}): Promise<readonly Chat[]> {
        this.assertNotDestroyed()
        await this.plugins.init()

        await this.plugins.callInterruptingHook('onBeforeChatQuery', 'DATABASE', { query })
        const chats = await this.database.listChats(query)
        await this.plugins.callHook('onAfterChatQuery', { query, chats })

        return chats
    }

    // -----------------------------------------------
    // Message Sending
    // -----------------------------------------------

    /**
     * Resolves when Messages.app accepts the AppleScript dispatch — acceptance,
     * not delivery. For the chat.db row or later `isDelivered` transitions
     * observe the watcher (`onFromMeMessage` callback on `startWatching`, or
     * plugin hook `onFromMe`); for "accepted" only, `onAfterSend` is lighter.
     *
     * The first `onBeforeSend` to throw aborts dispatch with `IMessageError`
     * (code `SEND`, thrown error as `cause`); `onAfterSend` does not fire.
     * Also throws `IMessageError` on validation, AppleScript dispatch, or
     * shutdown cancellation.
     */
    async send(request: SendRequest): Promise<void> {
        this.assertNotDestroyed()
        await this.plugins.init()

        await this.plugins.callInterruptingHook('onBeforeSend', 'SEND', { request })
        await this.sender.send(request)
        await this.plugins.callHook('onAfterSend', { request })
    }

    // -----------------------------------------------
    // Watcher
    // -----------------------------------------------

    /**
     * Start watching for new messages in real time.
     *
     * Independent of `sdk.send()` — sends do not require a watcher.
     * A running watcher gives you:
     *   - `onIncomingMessage` / `onDirectMessage` / `onGroupMessage` for peers' messages
     *   - `onFromMeMessage` for your own sends (including reads of
     *     `isDelivered`, edits, retractions as they land in chat.db)
     *
     * Throws `IMessageError` (code `CONFIG`) if a watcher is already
     * running on this SDK instance — stop the existing one first.
     */
    async startWatching(events: DispatchEvents = {}): Promise<void> {
        this.assertNotDestroyed()
        if (this.watchSource) throw ConfigError(ERROR_WATCHER_RUNNING)

        const dispatcher = new MessageDispatcher({
            events,
            sink: createPluginMessageSink(this.plugins),
            debug: this.debug,
        })

        const watcher = new MessageWatchSource({
            database: this.database,
            databasePath: this.databasePath,
            onBatch: (messages) => dispatcher.dispatch(messages),
            onError: (error) => dispatcher.handleError(error, 'watch-source'),
            debug: this.debug,
        })

        // Claim the slot SYNCHRONOUSLY — before any await — so a second
        // concurrent startWatching() call in the same tick hits the
        // `if (this.watchSource)` gate above and throws instead of
        // silently building a parallel watcher that would orphan us.
        // Also registers the watcher before start() so a racing
        // stopWatching()/close() can find and stop it; watcher.stop()
        // tolerates "not yet running" (see watcher.stop guard).
        this.watchSource = watcher

        try {
            await this.plugins.init()
            await watcher.start()
        } catch (error) {
            // watcher.start() already cleaned up its own resources on failure.
            if (this.watchSource === watcher) {
                this.watchSource = null
            }
            throw error
        }
    }

    /**
     * Stop watching for new messages.
     *
     * Resolves only after any in-flight batch dispatch has finished, so
     * callers chaining `await sdk.stopWatching()` observe a truly quiet SDK.
     */
    async stopWatching(): Promise<void> {
        await this.teardownWatcher()
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    /** Gracefully shut down the SDK and release all resources. */
    async close(): Promise<void> {
        // Concurrent callers must await the SAME in-flight shutdown — a
        // plain `if (this.destroyed) return` would let the second caller
        // resolve immediately while the first is still mid-teardown, so
        // its callers could race with not-yet-released resources
        // (database handle, temp files, plugin onDestroy).
        if (this.closePromise) return this.closePromise
        this.closePromise = this.doClose()
        return this.closePromise
    }

    private async doClose(): Promise<void> {
        this.destroyed = true

        const errors: ShutdownError[] = []

        this.abortController.abort(new Error('SDK closed'))

        // Await watcher teardown BEFORE destroying plugins: stop() drains
        // the consumer loop, so no onBatch (= onIncomingMessage dispatch) can
        // fire after the plugins' onDestroy hooks run.
        await safeRun(errors, 'watcher', () => this.teardownWatcher())
        await safeRun(errors, 'pluginManager', () => this.plugins.destroy())
        await safeRun(errors, 'tempFileManager', () => this.tempFiles.destroy())
        await safeRun(errors, 'database', () => this.database.close())

        if (errors.length > 0) {
            if (this.debug) {
                const summary = errors.map((e) => `${e.component}: ${e.error.message}`).join('; ')
                console.error(`[SDK] Shutdown failed — ${summary}`)
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

    private assertNotDestroyed(): void {
        if (this.destroyed) throw ConfigError(ERROR_SDK_DESTROYED)
    }

    /**
     * Single path for tearing down the watcher.
     *
     * Awaits `watchSource.stop()` so that any in-flight `onBatch` dispatch
     * has completed before we return to the caller — this is what
     * prevents plugin `onIncomingMessage` from racing with `onDestroy` during
     * SDK shutdown.
     */
    private async teardownWatcher(): Promise<void> {
        const watcher = this.watchSource
        this.watchSource = null
        if (watcher) await watcher.stop()
    }
}

// -----------------------------------------------
// Pure helpers
// -----------------------------------------------

function validateBound(
    value: number | undefined,
    bound: {
        readonly default: number
        readonly min: number
        readonly max: number
    },
    name: string
): number {
    const resolved = value ?? bound.default

    if (resolved < bound.min || resolved > bound.max) {
        throw ConfigError(`${name} must be between ${bound.min} and ${bound.max}, got ${resolved}`)
    }

    return resolved
}

async function safeRun(errors: ShutdownError[], component: string, fn: () => void | Promise<void>): Promise<void> {
    try {
        await fn()
    } catch (error) {
        errors.push({ component, error: toError(error) })
    }
}
