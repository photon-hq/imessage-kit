/**
 * Message Watcher
 */

import type { PluginManager } from '../plugins/core'
import type { WebhookConfig } from '../types/config'
import type { Message } from '../types/message'
import type { IMessageDatabase } from './database'
import { WebhookError } from './errors'

/** Message callback */
export type MessageCallback = (message: Message) => void | Promise<void>

/** Watcher event callbacks */
export interface WatcherEvents {
    /** Triggered when new 1-on-1 message arrives */
    onNewMessage?: MessageCallback
    /** Triggered when new group chat message arrives (optional, ignored by default) */
    onGroupMessage?: MessageCallback
    /** Triggered when error occurs */
    onError?: (error: Error) => void
}

/**
 * Message Watcher Class
 */
export class MessageWatcher {
    /** Whether currently running */
    private isRunning = false
    /** Polling timer ID */
    private intervalId: ReturnType<typeof setInterval> | null = null
    /** Whether currently checking */
    private isChecking = false
    /** Last check time (for incremental queries) */
    private lastCheckTime: Date
    /** Set of processed message IDs (simple deduplication) */
    private seenMessageIds = new Map<string, number>()

    constructor(
        private database: IMessageDatabase,
        private pollInterval: number,
        private unreadOnly: boolean,
        private excludeOwnMessages: boolean,
        private webhookConfig: WebhookConfig | null,
        private events: WatcherEvents = {},
        private pluginManager?: PluginManager,
        private debug = false
    ) {
        this.lastCheckTime = new Date()
    }

    /**
     * Start watching for new messages
     */
    async start(): Promise<void> {
        if (this.isRunning) return

        this.isRunning = true
        if (this.debug) {
            console.log(`[Watcher] Started (poll interval: ${this.pollInterval}ms)`)
        }

        try {
            await this.check()
        } catch (error) {
            this.isRunning = false
            throw error
        }

        this.intervalId = setInterval(() => {
            this.check().catch((error) => {
                this.handleError(error)
            })
        }, this.pollInterval)
    }

    /**
     * Stop watching
     */
    stop(): void {
        if (!this.isRunning) return

        this.isRunning = false
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }

        if (this.debug) {
            console.log('[Watcher] Stopped')
        }
    }

    /**
     * Check for new messages
     */
    private async check() {
        if (this.isChecking) return

        this.isChecking = true
        try {
            const overlapMs = Math.min(1000, this.pollInterval)
            const checkStart = new Date()
            const since = new Date(this.lastCheckTime.getTime() - overlapMs)

            const { messages } = await this.database.getMessages({
                since,
            })

            this.lastCheckTime = checkStart

            /** Filter out new messages */
            let newMessages = messages.filter((msg) => !this.seenMessageIds.has(msg.id))

            /** Filter by unread status if configured */
            if (this.unreadOnly) {
                newMessages = newMessages.filter((msg) => !msg.isRead)
            }

            /** Filter out own messages if configured (default: true) */
            if (this.excludeOwnMessages) {
                newMessages = newMessages.filter((msg) => !msg.isFromMe)
            }

            /** Mark as processed */
            const now = Date.now()
            for (const msg of newMessages) {
                this.seenMessageIds.set(msg.id, now)
            }

            /** Process all new messages concurrently */
            await Promise.all(
                newMessages.map((msg) => this.handleNewMessage(msg).catch((err) => this.handleError(err)))
            )

            /** Keep only messages from last 1 hour */
            if (this.seenMessageIds.size > 10000) {
                const hourAgo = now - 3600000
                for (const [id, timestamp] of this.seenMessageIds.entries()) {
                    if (timestamp < hourAgo) {
                        this.seenMessageIds.delete(id)
                    }
                }
            }
        } catch (error) {
            this.handleError(error)
        } finally {
            this.isChecking = false
        }
    }

    /**
     * Handle new message
     * Triggers in sequence: Plugin hooks -> Event callback -> Webhook notification
     * @param message New message object
     */
    private async handleNewMessage(message: Message) {
        try {
            /** Call plugin's onNewMessage hook (always, for all messages) */
            await this.pluginManager?.callHookForAll('onNewMessage', message)

            /** Dispatch to appropriate event callback based on message type */
            if (message.isGroupChat) {
                await this.events.onGroupMessage?.(message)
            } else {
                await this.events.onNewMessage?.(message)
            }

            /** Send webhook notification */
            if (this.webhookConfig) await this.sendWebhook(message)
        } catch (error) {
            this.handleError(error)
        }
    }

    /**
     * Send webhook notification
     * POST message data to configured webhook URL
     * @param message Message to notify
     */
    private async sendWebhook(message: Message): Promise<void> {
        if (!this.webhookConfig) return

        const retries = this.webhookConfig.retries ?? 0
        const backoffMs = this.webhookConfig.backoffMs ?? 0

        let lastError: unknown = null
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(this.webhookConfig.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...this.webhookConfig.headers,
                    },
                    body: JSON.stringify({
                        event: 'new_message',
                        message: {
                            id: message.id,
                            text: message.text,
                            sender: message.sender,
                            senderName: message.senderName,
                            isRead: message.isRead,
                            service: message.service,
                            hasAttachments: message.attachments.length > 0,
                            attachments: message.attachments.map((a) => ({
                                filename: a.filename,
                                mimeType: a.mimeType,
                                size: a.size,
                                isImage: a.isImage,
                            })),
                            date: message.date.toISOString(),
                        },
                        timestamp: new Date().toISOString(),
                    }),
                    signal: AbortSignal.timeout(this.webhookConfig.timeout || 5000),
                })

                if (!response.ok) {
                    throw WebhookError(`Webhook failed with status ${response.status}`)
                }
                // Success
                return
            } catch (error) {
                lastError = error
                if (attempt < retries && backoffMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, backoffMs))
                }
            }
        }
        throw WebhookError(
            `Failed to send webhook: ${
                lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
            }`
        )
    }

    /**
     * Unified error handling
     * Output error to console and trigger error callback
     * @param error Error object of any type
     */
    private handleError(error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error))
        if (this.debug) {
            console.error('[Watcher] Error:', err)
        }
        this.events.onError?.(err)
    }
}
