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
import type { ChatSummary, Message, MessageFilter, MessageQueryResult, SendResult } from '../types/message'
import { validateChatId } from '../utils/common'
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
        requireMacOS()
        this.config = this.resolveConfig(config)
        this.database = dependencies?.database ?? new IMessageDatabase(this.config.databasePath)

        this.tempFileManager = new TempFileManager({
            maxAge: this.config.tempFile?.maxAge,
            cleanupInterval: this.config.tempFile?.cleanupInterval,
            debug: this.config.debug,
        })
        this.tempFileManager.start()

        this.sender =
            dependencies?.sender ??
            new MessageSender(
                this.config.debug,
                this.config.retry,
                this.config.maxConcurrent,
                this.config.scriptTimeout
            )

        this.pluginManager = dependencies?.pluginManager ?? new PluginManager()

        if (config.plugins) {
            for (const plugin of config.plugins) {
                this.pluginManager.use(plugin)
            }
        }

        if (this.config.debug) {
            console.log('[SDK] Initialization complete')
        }
    }

    private async ensurePluginsReady() {
        if (!this.pluginManager.initialized) {
            await this.pluginManager.init()
        }
    }

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
                excludeOwnMessages: config.watcher?.excludeOwnMessages ?? true,
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

    /**
     * Generic wrapper for sending messages to a chat by chatId
     */
    private async sendToChatWithHooks(
        chatId: string,
        sendFn: (chatId: string) => Promise<SendResult>,
        content: { text?: string; attachments?: string[] }
    ): Promise<SendResult> {
        if (this.destroyed) throw new Error('SDK is destroyed')

        // Validate chatId format early (GUID for groups, or "<service>;<address>" for DMs)
        validateChatId(chatId)

        await this.ensurePluginsReady()
        await this.pluginManager.callHookForAll('onBeforeSend', chatId, content)

        const result = await sendFn(chatId)

        await this.pluginManager.callHookForAll('onAfterSend', chatId, result)

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

        // Resolve chatId for plugin hooks, but send via recipient-based path to preserve behavior
        const recipient = typeof to === 'string' ? asRecipient(to) : to
        const chatId = recipient.includes(';') ? recipient : `iMessage;${recipient}`

        if (this.destroyed) throw new Error('SDK is destroyed')
        await this.ensurePluginsReady()
        await this.pluginManager.callHookForAll('onBeforeSend', chatId, {
            text: normalized.text,
            attachments: normalized.attachments,
        })

        const result = await this.sender.send({
            to: recipient,
            text: normalized.text,
            attachments: normalized.attachments,
        })

        await this.pluginManager.callHookForAll('onAfterSend', chatId, result)
        return result
    }

    /**
     * Send message to a chat by chatId
     */
    async sendToChat(
        chatId: string,
        content: string | { text?: string; images?: string[]; files?: string[] }
    ): Promise<SendResult> {
        const normalized =
            typeof content === 'string'
                ? { text: content, attachments: [] }
                : {
                      text: content.text,
                      attachments: [...(content.images || []), ...(content.files || [])],
                  }

        return this.sendToChatWithHooks(
            chatId,
            (c) =>
                this.sender.sendToChat({
                    chatId: c,
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
     * List chats for discovering chatId easily
     *
     * @example
     * ```ts
     * const chats = await sdk.listChats(50)
     * for (const c of chats) {
     *   console.log(c.chatId, c.displayName, c.lastMessageAt, c.isGroup)
     * }
     * ```
     */
    async listChats(limit?: number): Promise<ChatSummary[]> {
        if (this.destroyed) throw new Error('SDK is destroyed')
        await this.ensurePluginsReady()
        // Plugins can observe queries via existing hooks if needed
        await this.pluginManager.callHookForAll('onBeforeQuery', { limit })
        const result = await this.database.listChats(limit)
        // Reuse onAfterQuery to keep plugin ecosystem simple (messages not available here)
        await this.pluginManager.callHookForAll('onAfterQuery', [])
        return result
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

    /** Send single file to a chat by chatId */
    async sendFileToChat(chatId: string, filePath: string, text?: string): Promise<SendResult> {
        return this.sendToChat(chatId, { text, files: [filePath] })
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

    /** Send multiple files to a chat by chatId */
    async sendFilesToChat(chatId: string, filePaths: string[], text?: string): Promise<SendResult> {
        return this.sendToChat(chatId, { text, files: filePaths })
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
            this.config.watcher.excludeOwnMessages,
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
