/**
 * IMessage SDK - Type-safe macOS iMessage SDK
 *
 * @example
 * ```typescript
 * import { IMessageSDK, loggerPlugin } from '@photon-ai/imessage-kit'
 *
 * const sdk = new IMessageSDK({
 *   plugins: [loggerPlugin()]
 * })
 *
 * /// Send messages
 * await sdk.send('+1234567890', 'Hello!')
 * await sdk.send('+1234567890', { images: ['photo.jpg'] })
 *
 * /// Chain processing
 * await sdk.message(msg)
 *   .ifFromOthers()
 *   .matchText('hello')
 *   .replyText('Hi!')
 *   .execute()
 * ```
 */

import { type Plugin, PluginManager } from '../plugins/core'
import type { Recipient } from '../types/advanced'
import { asRecipient } from '../types/advanced'
import type { IMessageConfig, ResolvedConfig } from '../types/config'
import type { Message, MessageFilter, MessageQueryResult, SendResult } from '../types/message'
import { getDefaultDatabasePath, requireMacOS } from '../utils/platform'
import { TempFileManager } from '../utils/temp-file-manager'
import { MessageChain } from './chain'
import { IMessageDatabase } from './database'
import { MessageSender } from './sender'
import { MessageWatcher, type WatcherEvents } from './watcher'

/** SDK dependency injection interface */
export interface SDKDependencies {
    database?: IMessageDatabase
    sender?: MessageSender
    pluginManager?: PluginManager
}

/** IMessage SDK Core Class */
export class IMessageSDK {
    /** Configuration */
    private readonly config: ResolvedConfig

    /** Database */
    private readonly database: IMessageDatabase

    /** Temporary file manager */
    private readonly tempFileManager: TempFileManager

    /** Message sender */
    private readonly sender: MessageSender

    /** Plugin manager */
    private readonly pluginManager: PluginManager

    /** Message watcher */
    private watcher: MessageWatcher | null = null

    /** Whether destroyed */
    private destroyed = false

    constructor(config: IMessageConfig = {}, dependencies?: SDKDependencies) {
        /** Check macOS system */
        requireMacOS()

        /** Resolve configuration */
        this.config = this.resolveConfig(config)

        /** Create database */
        this.database = dependencies?.database ?? new IMessageDatabase(this.config.databasePath)

        /** Create temporary file manager */
        this.tempFileManager = new TempFileManager({
            maxAge: this.config.tempFile?.maxAge,
            cleanupInterval: this.config.tempFile?.cleanupInterval,
            debug: this.config.debug,
        })
        this.tempFileManager.start()

        /** Create sender */
        this.sender =
            dependencies?.sender ??
            new MessageSender(
                this.config.debug,
                this.config.retry,
                this.config.maxConcurrent,
                this.config.scriptTimeout
            )

        /** Create plugin manager */
        this.pluginManager = dependencies?.pluginManager ?? new PluginManager()

        /** Register plugins (synchronous) */
        if (config.plugins) {
            for (const plugin of config.plugins) {
                this.pluginManager.use(plugin)
            }
        }

        // Output initialization info in debug mode
        if (this.config.debug) {
            console.log('[SDK] Initialization complete')
        }
    }

    /** Lazy initialize plugins (called on first use) */
    private async ensurePluginsReady() {
        if (!this.pluginManager.initialized) {
            await this.pluginManager.init()
        }
    }

    /** Resolve configuration */
    private resolveConfig(config: IMessageConfig): ResolvedConfig {
        const clamp = (v: number | undefined, min: number, max: number, def: number) => {
            const val = v ?? def
            if (val < min || val > max) {
                throw new Error(`Value must be between ${min} and ${max}`)
            }
            return val
        }

        return {
            databasePath: config.databasePath ?? getDefaultDatabasePath(),
            webhook: config.webhook ?? null,
            watcher: {
                pollInterval: clamp(config.watcher?.pollInterval, 100, 60000, 2000),
                unreadOnly: config.watcher?.unreadOnly ?? false,
            },
            retry: {
                max: clamp(config.retry?.max, 0, 10, 2),
                delay: clamp(config.retry?.delay, 0, 10000, 1500),
            },
            tempFile: {
                maxAge: clamp(config.tempFile?.maxAge, 60000, 3600000, 600000),
                // 1 minute ~ 1 hour, default 10 minutes
                cleanupInterval: clamp(config.tempFile?.cleanupInterval, 60000, 1800000, 300000), // 1 minute ~ 30 minutes, default 5 minutes
            },
            scriptTimeout: clamp(config.scriptTimeout, 5000, 120000, 30000),
            // 5 seconds ~ 2 minutes, default 30 seconds
            maxConcurrent: clamp(config.maxConcurrent, 0, 50, 5),
            debug: config.debug ?? false,
        }
    }

    /** Generic wrapper for sending messages */
    private async sendWithHooks(
        to: string | Recipient,
        sendFn: (recipient: string) => Promise<SendResult>,
        content: { text?: string; attachments?: string[] }
    ): Promise<SendResult> {
        if (this.destroyed) throw new Error('SDK is destroyed')

        /** Ensure plugins are ready */
        await this.ensurePluginsReady()

        /** Get recipient */
        const recipient = typeof to === 'string' ? asRecipient(to) : to

        /** Call before-send hooks */
        await this.pluginManager.callHookForAll('onBeforeSend', recipient, content)

        /** Send message */
        const result = await sendFn(recipient)

        /** Call after-send hooks */
        await this.pluginManager.callHookForAll('onAfterSend', recipient, result)

        return result
    }

    /**
     * Register plugin
     */
    use(plugin: Plugin): this {
        if (this.destroyed) throw new Error('SDK is destroyed')
        this.pluginManager.use(plugin)
        return this
    }

    /**
     * Get plugin manager
     * @returns PluginManager instance
     */
    get plugins() {
        return this.pluginManager
    }

    /**
     * Query messages
     */
    async getMessages(filter?: MessageFilter): Promise<MessageQueryResult> {
        if (this.destroyed) throw new Error('SDK is destroyed')

        await this.ensurePluginsReady()
        await this.pluginManager.callHookForAll('onBeforeQuery', filter)
        const result = await this.database.getMessages(filter)
        await this.pluginManager.callHookForAll('onAfterQuery', result.messages)

        return result
    }

    /**
     * Get unread messages (grouped by sender)
     */
    async getUnreadMessages(): Promise<Array<{ sender: string; messages: Message[] }>> {
        if (this.destroyed) throw new Error('SDK is destroyed')

        const map = await this.database.getUnreadMessages()
        return Array.from(map.entries()).map(([sender, messages]) => ({
            sender,
            messages,
        }))
    }

    /**
     * Send message
     *
     * @example
     * ```ts
     * await sdk.send(phone, 'Hello')
     * await sdk.send(phone, { images: ['/img.jpg'] })
     * await sdk.send(phone, { text: 'Hi', images: ['/img.jpg'] })
     * await sdk.send(phone, { files: ['/document.pdf', '/contact.vcf'] })
     * await sdk.send(phone, { text: 'Check this', files: ['/data.csv'] })
     * ```
     */
    async send(
        to: string | Recipient,
        content: string | { text?: string; images?: string[]; files?: string[] }
    ): Promise<SendResult> {
        /** Normalize to object format */
        const normalized =
            typeof content === 'string'
                ? { text: content, attachments: [] }
                : {
                    text: content.text,
                    attachments: [...(content.images || []), ...(content.files || [])],
                }

        /** Delegate to sender for validation and sending */
        return this.sendWithHooks(
            to,
            (r) =>
                this.sender.send({
                    to: r,
                    text: normalized.text,
                    attachments: normalized.attachments,
                }),
            {
                text: normalized.text,
                attachments: normalized.attachments,
            }
        )
    }

    /**
     * Send batch messages (concurrency controlled by sender's maxConcurrent config)
     *
     * @param messages Batch message list
     * @returns List of send results (including success and failure)
     *
     * @example
     * ```ts
     * const results = await sdk.sendBatch([
     *   { to: '+1234567890', content: 'Hello' },
     *   { to: '+0987654321', content: 'Hi' },
     * ])
     *
     * for (const result of results) {
     *   if (result.success) {
     *     console.log('Send success:', result.to)
     *   } else {
     *     console.error('Send failed:', result.to, result.error)
     *   }
     * }
     * ```
     */
    async sendBatch(
        messages: Array<{
            to: string | Recipient
            content: string | { text?: string; images?: string[]; files?: string[] }
        }>
    ): Promise<
        Array<{
            to: string
            success: boolean
            result?: SendResult
            error?: Error
        }>
    > {
        if (this.destroyed) throw new Error('SDK is destroyed')

        const results = await Promise.allSettled(
            messages.map(async ({ to, content }) => ({
                to: String(to),
                result: await this.send(to, content),
            }))
        )

        return results.map((result, index) => {
            const to = String(messages[index]!.to)

            if (result.status === 'fulfilled') {
                return {
                    to,
                    success: true,
                    result: result.value.result,
                }
            }
            return {
                to,
                success: false,
                error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
            }
        })
    }

    /**
     * Send file (convenience method)
     *
     * @example
     * ```ts
     * await sdk.sendFile('+1234567890', '/path/to/document.pdf')
     * await sdk.sendFile('+1234567890', '/path/to/contact.vcf', 'Here is the contact')
     * ```
     */
    async sendFile(to: string | Recipient, filePath: string, text?: string): Promise<SendResult> {
        return this.send(to, { text, files: [filePath] })
    }

    /**
     * Send multiple files (convenience method)
     *
     * @example
     * ```ts
     * await sdk.sendFiles('+1234567890', ['/file1.pdf', '/file2.csv'])
     * await sdk.sendFiles('+1234567890', ['/data.xlsx'], 'Check these files')
     * ```
     */
    async sendFiles(to: string | Recipient, filePaths: string[], text?: string): Promise<SendResult> {
        return this.send(to, { text, files: filePaths })
    }

    // ==================== Message Chain Processing ====================

    /**
     * Create message processing chain
     */
    message(message: Message) {
        if (this.destroyed) throw new Error('SDK is destroyed')
        return new MessageChain(message, this.sender)
    }

    /**
     * Start watching for new messages
     */
    async startWatching(events?: WatcherEvents): Promise<void> {
        if (this.destroyed) throw new Error('SDK is destroyed')
        if (this.watcher) throw new Error('Watcher is already running')

        const watcher = new MessageWatcher(
            this.database,
            this.config.watcher.pollInterval,
            this.config.watcher.unreadOnly,
            this.config.webhook,
            events,
            this.pluginManager,
            this.config.debug
        )

        try {
            await watcher.start()
            this.watcher = watcher
        } catch (error) {
            watcher.stop()
            throw error
        }
    }

    /**
     * Stop watching for new messages
     */
    stopWatching(): void {
        this.watcher?.stop()
        this.watcher = null
    }

    /**
     * Close SDK and release resources
     */
    async close() {
        if (this.destroyed) return

        this.destroyed = true
        const errors: Array<{ component: string; error: Error }> = []

        /** 1. Stop watcher */
        try {
            this.watcher?.stop()
        } catch (error) {
            errors.push({
                component: 'watcher',
                error: error instanceof Error ? error : new Error(String(error)),
            })
        }
        this.watcher = null

        /** 2. Destroy plugins */
        try {
            await this.pluginManager.destroy()
        } catch (error) {
            errors.push({
                component: 'pluginManager',
                error: error instanceof Error ? error : new Error(String(error)),
            })
        }

        /** 3. Destroy temporary file manager (clean up all temp files) */
        try {
            await this.tempFileManager.destroy()
        } catch (error) {
            errors.push({
                component: 'tempFileManager',
                error: error instanceof Error ? error : new Error(String(error)),
            })
        }

        /** 4. Close database */
        try {
            this.database.close()
        } catch (error) {
            errors.push({
                component: 'database',
                error: error instanceof Error ? error : new Error(String(error)),
            })
        }

        /** If there are errors, aggregate and throw */
        if (errors.length > 0) {
            if (this.config.debug) {
                console.error('[SDK] Error occurred during shutdown:', errors)
            }

            /** Node.js 15+ supports AggregateError */
            if (typeof AggregateError !== 'undefined') {
                throw new AggregateError(
                    errors.map((e) => e.error),
                    `SDK shutdown failed: ${errors.map((e) => e.component).join(', ')}`
                )
            }
            /** Fallback: throw first error */
            throw errors[0]!.error
        }
    }

    /** Support using declaration (TypeScript 5.2+) */
    async [Symbol.asyncDispose]() {
        await this.close()
    }

    /** Support using declaration (sync version) */
    [Symbol.dispose]() {
        this.close().catch(console.error)
    }
}
