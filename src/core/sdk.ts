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
import { type Recipient, asRecipient } from '../types/advanced'
import type { IMessageConfig, ResolvedConfig } from '../types/config'
import type {
    ChatSummary,
    ListChatsOptions,
    Message,
    MessageFilter,
    MessageQueryResult,
    SendResult,
    UnreadMessagesResult,
} from '../types/message'
import { extractRecipientFromChatId, isGroupChatId, validateChatId } from '../utils/common'
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
     * Determine if a string is a chatId (not a recipient)
     *
     * ChatId formats:
     * - Group GUID: `chat123...`
     * - AppleScript group: `iMessage;+;chat123...`
     *
     * Recipient formats:
     * - Phone: `+1234567890`
     * - Email: `user@example.com`
     *
     * Note: `iMessage;+1234567890` is NOT a chatId for routing purposes.
     * It's a service-prefixed recipient that should be sent via buddy method.
     */
    private isChatId(value: string): boolean {
        // Use helper to check if it's a group chat
        if (isGroupChatId(value)) {
            return true
        }

        // Try to parse as recipient
        try {
            asRecipient(value)
            return false // It's a valid recipient
        } catch {
            // Not a valid recipient, could be service-prefixed DM
            // Try to extract recipient from service-prefixed format
            const extracted = extractRecipientFromChatId(value)
            if (extracted) {
                // It's a service-prefixed DM, treat as recipient
                return false
            }
            // Unknown format, treat as chatId
            return true
        }
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
     *
     * @returns Unread messages with statistics
     * @example
     * ```ts
     * const unread = await sdk.getUnreadMessages()
     * console.log(`${unread.total} unread messages from ${unread.senderCount} senders`)
     * for (const { sender, messages } of unread.groups) {
     *   console.log(`${sender}: ${messages.length} messages`)
     * }
     * ```
     */
    async getUnreadMessages(): Promise<UnreadMessagesResult> {
        if (this.destroyed) throw new Error('SDK is destroyed')

        const { grouped, total } = await this.database.getUnreadMessages()
        const groups = Array.from(grouped.entries()).map(([sender, messages]) => ({
            sender,
            messages,
        }))

        return {
            groups,
            total,
            senderCount: groups.length,
        }
    }

    /**
     * Send message to recipient (phone/email) or chat (chatId)
     *
     * Automatically detects whether the target is:
     * - A recipient (phone number or email): e.g., '+1234567890', 'user@example.com'
     * - A chatId (group or DM): e.g., 'chat123...', 'iMessage;+1234567890'
     *
     * @example
     * ```ts
     * // Send to phone number
     * await sdk.send('+1234567890', 'Hello')
     *
     * // Send to email
     * await sdk.send('user@example.com', 'Hello')
     *
     * // Send to group chat
     * await sdk.send('chat123...', 'Hello')
     *
     * // Send with attachments
     * await sdk.send('+1234567890', { images: ['/img.jpg'] })
     * await sdk.send('chat123...', { text: 'Hi', files: ['/doc.pdf'] })
     * ```
     */
    async send(
        to: string | Recipient,
        content: string | { text?: string; images?: string[]; files?: string[] }
    ): Promise<SendResult> {
        if (this.destroyed) throw new Error('SDK is destroyed')

        /** Normalize to object format */
        const normalized =
            typeof content === 'string'
                ? { text: content, attachments: [] }
                : {
                      text: content.text,
                      attachments: [...(content.images || []), ...(content.files || [])],
                  }

        const target = String(to)

        // Determine if target is a chatId or recipient
        const isChatIdTarget = this.isChatId(target)

        if (isChatIdTarget) {
            // Target is a group chat - validate and send to group
            validateChatId(target)

            await this.ensurePluginsReady()
            await this.pluginManager.callHookForAll('onBeforeSend', target, {
                text: normalized.text,
                attachments: normalized.attachments,
            })

            const result = await this.sender.sendToGroup({
                groupId: target,
                text: normalized.text,
                attachments: normalized.attachments,
            })

            await this.pluginManager.callHookForAll('onAfterSend', target, result)
            return result
        }

        // Target is a recipient (phone/email or service-prefixed)
        // Extract pure recipient if it's service-prefixed (e.g., 'iMessage;+1234567890' -> '+1234567890')
        const extracted = extractRecipientFromChatId(target)
        const recipient = extracted || asRecipient(target)
        const chatId = target.includes(';') ? target : `iMessage;${recipient}`

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
     * List chats with filtering and sorting options
     *
     * @param options Filter and sort options (or a number for backward compatibility)
     * @returns Array of chat summaries with unread counts
     *
     * @example
     * ```ts
     * // Get all chats
     * const all = await sdk.listChats()
     *
     * // Get recent group chats with unread messages
     * const groups = await sdk.listChats({
     *   type: 'group',
     *   hasUnread: true,
     *   limit: 20
     * })
     *
     * // Search chats by name
     * const found = await sdk.listChats({
     *   search: 'John',
     *   sortBy: 'name'
     * })
     *
     * // Backward compatible: limit only
     * const recent = await sdk.listChats({ limit: 50 })
     * ```
     */
    async listChats(options?: ListChatsOptions | number): Promise<ChatSummary[]> {
        if (this.destroyed) throw new Error('SDK is destroyed')
        await this.ensurePluginsReady()

        // Backward compatibility: convert number to options object
        const opts: ListChatsOptions = typeof options === 'number' ? { limit: options } : options || {}

        await this.pluginManager.callHookForAll('onBeforeQuery', opts)
        const result = await this.database.listChats(opts)
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
     * Supports both recipient (phone/email) and chatId
     *
     * @example
     * ```ts
     * // Send to phone number
     * await sdk.sendFile('+1234567890', '/path/to/document.pdf')
     *
     * // Send to group chat
     * await sdk.sendFile('chat123...', '/path/to/document.pdf', 'Here is the file')
     * ```
     */
    async sendFile(to: string | Recipient, filePath: string, text?: string): Promise<SendResult> {
        return this.send(to, { text, files: [filePath] })
    }

    /**
     * Send multiple files (convenience method)
     *
     * Supports both recipient (phone/email) and chatId
     *
     * @example
     * ```ts
     * // Send to phone number
     * await sdk.sendFiles('+1234567890', ['/file1.pdf', '/file2.csv'])
     *
     * // Send to group chat
     * await sdk.sendFiles('chat123...', ['/data.xlsx'], 'Check these files')
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
