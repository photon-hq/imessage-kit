/**
 * Message Scheduler
 *
 * Schedule messages for future delivery with support for:
 * - One-time scheduled messages
 * - Recurring messages (daily, weekly, custom intervals)
 * - Cancellation and rescheduling
 * - Persistence-friendly design (export/import scheduled tasks)
 *
 * @example
 * ```ts
 * import { IMessageSDK, MessageScheduler } from '@photon-ai/imessage-kit'
 *
 * const sdk = new IMessageSDK()
 * const scheduler = new MessageScheduler(sdk)
 *
 * // Schedule a message for 5 minutes from now
 * const id = scheduler.schedule({
 *   to: '+1234567890',
 *   content: 'Hey! Just a reminder about our meeting.',
 *   sendAt: new Date(Date.now() + 5 * 60 * 1000)
 * })
 *
 * // Schedule a daily good morning message
 * scheduler.scheduleRecurring({
 *   to: '+1234567890',
 *   content: 'Good morning! ☀️',
 *   startAt: new Date('2025-01-01T08:00:00'),
 *   interval: 'daily'
 * })
 *
 * // Cancel a scheduled message
 * scheduler.cancel(id)
 *
 * // Clean up when done
 * scheduler.destroy()
 * await sdk.close()
 * ```
 */

import type { IMessageSDK } from '../core/sdk'
import type { SendResult } from '../core/sender'

/** Scheduled message status */
export type ScheduledMessageStatus = 'pending' | 'sent' | 'failed' | 'cancelled'

/** Recurrence interval */
export type RecurrenceInterval = 'hourly' | 'daily' | 'weekly' | 'monthly' | number

/** Base scheduled message info */
interface ScheduledMessageBase {
    /** Unique ID for this scheduled message */
    readonly id: string
    /** Recipient (phone, email, or chatId) */
    readonly to: string
    /** Message content */
    readonly content: string | { text?: string; images?: string[]; files?: string[] }
    /** When to send */
    readonly sendAt: Date
    /** Current status */
    status: ScheduledMessageStatus
    /** Error message if failed */
    error?: string
    /** Send result if successful */
    result?: SendResult
    /** Creation timestamp */
    readonly createdAt: Date
}

/** One-time scheduled message */
export interface ScheduledMessage extends ScheduledMessageBase {
    readonly type: 'once'
}

/** Recurring scheduled message */
export interface RecurringMessage extends ScheduledMessageBase {
    readonly type: 'recurring'
    /** Recurrence interval */
    readonly interval: RecurrenceInterval
    /** End date (optional - runs forever if not set) */
    readonly endAt?: Date
    /** Number of times sent */
    sendCount: number
    /** Next scheduled time */
    nextSendAt: Date
}

/** Options for scheduling a one-time message */
export interface ScheduleOptions {
    /** Recipient (phone, email, or chatId) */
    to: string
    /** Message content */
    content: string | { text?: string; images?: string[]; files?: string[] }
    /** When to send */
    sendAt: Date
    /** Optional custom ID */
    id?: string
}

/** Options for scheduling a recurring message */
export interface RecurringScheduleOptions extends Omit<ScheduleOptions, 'sendAt'> {
    /** Start time for first message */
    startAt: Date
    /** Recurrence interval ('hourly', 'daily', 'weekly', 'monthly', or milliseconds) */
    interval: RecurrenceInterval
    /** End date (optional) */
    endAt?: Date
}

/** Scheduler event callbacks */
export interface SchedulerEvents {
    /** Called when a message is sent successfully */
    onSent?: (message: ScheduledMessage | RecurringMessage, result: SendResult) => void
    /** Called when a message fails to send */
    onError?: (message: ScheduledMessage | RecurringMessage, error: Error) => void
    /** Called when a recurring message completes (reaches endAt) */
    onComplete?: (message: RecurringMessage) => void
}

/** Scheduler configuration */
export interface SchedulerConfig {
    /** Check interval in milliseconds (default: 1000) */
    checkInterval?: number
    /** Enable debug logging (default: false) */
    debug?: boolean
}

/**
 * Generate a unique ID
 */
function generateId(): string {
    return `sched_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Calculate next send time based on interval
 */
function calculateNextSendTime(current: Date, interval: RecurrenceInterval): Date {
    const next = new Date(current)

    if (typeof interval === 'number') {
        next.setTime(next.getTime() + interval)
    } else {
        switch (interval) {
            case 'hourly':
                next.setHours(next.getHours() + 1)
                break
            case 'daily':
                next.setDate(next.getDate() + 1)
                break
            case 'weekly':
                next.setDate(next.getDate() + 7)
                break
            case 'monthly':
                next.setMonth(next.getMonth() + 1)
                break
        }
    }

    return next
}

/**
 * Message Scheduler
 *
 * Schedules messages for future delivery using the IMessageSDK
 */
export class MessageScheduler {
    private readonly sdk: IMessageSDK
    private readonly config: Required<SchedulerConfig>
    private readonly events: SchedulerEvents

    private readonly scheduled: Map<string, ScheduledMessage> = new Map()
    private readonly recurring: Map<string, RecurringMessage> = new Map()

    private intervalHandle: ReturnType<typeof setInterval> | null = null
    private destroyed = false

    constructor(sdk: IMessageSDK, config?: SchedulerConfig, events?: SchedulerEvents) {
        this.sdk = sdk
        this.config = {
            checkInterval: config?.checkInterval ?? 1000,
            debug: config?.debug ?? false,
        }
        this.events = events ?? {}

        this.start()
    }

    /**
     * Schedule a one-time message
     *
     * @returns The scheduled message ID
     */
    schedule(options: ScheduleOptions): string {
        if (this.destroyed) {
            throw new Error('Scheduler has been destroyed')
        }

        const now = new Date()
        if (options.sendAt <= now) {
            throw new Error('sendAt must be in the future')
        }

        const id = options.id ?? generateId()

        if (this.scheduled.has(id) || this.recurring.has(id)) {
            throw new Error(`Message with ID "${id}" already exists`)
        }

        const message: ScheduledMessage = {
            id,
            type: 'once',
            to: options.to,
            content: options.content,
            sendAt: options.sendAt,
            status: 'pending',
            createdAt: now,
        }

        this.scheduled.set(id, message)

        if (this.config.debug) {
            console.log(`[Scheduler] Scheduled message ${id} for ${options.sendAt.toISOString()}`)
        }

        return id
    }

    /**
     * Schedule a recurring message
     *
     * @returns The recurring message ID
     */
    scheduleRecurring(options: RecurringScheduleOptions): string {
        if (this.destroyed) {
            throw new Error('Scheduler has been destroyed')
        }

        const now = new Date()
        if (options.startAt <= now) {
            throw new Error('startAt must be in the future')
        }

        if (options.endAt && options.endAt <= options.startAt) {
            throw new Error('endAt must be after startAt')
        }

        const id = options.id ?? generateId()

        if (this.scheduled.has(id) || this.recurring.has(id)) {
            throw new Error(`Message with ID "${id}" already exists`)
        }

        const message: RecurringMessage = {
            id,
            type: 'recurring',
            to: options.to,
            content: options.content,
            sendAt: options.startAt,
            interval: options.interval,
            endAt: options.endAt,
            status: 'pending',
            createdAt: now,
            sendCount: 0,
            nextSendAt: options.startAt,
        }

        this.recurring.set(id, message)

        if (this.config.debug) {
            console.log(
                `[Scheduler] Scheduled recurring message ${id} starting ${options.startAt.toISOString()} (${options.interval})`
            )
        }

        return id
    }

    /**
     * Cancel a scheduled message
     *
     * @returns true if cancelled, false if not found
     */
    cancel(id: string): boolean {
        const scheduled = this.scheduled.get(id)
        if (scheduled && scheduled.status === 'pending') {
            scheduled.status = 'cancelled'
            this.scheduled.delete(id)
            if (this.config.debug) {
                console.log(`[Scheduler] Cancelled message ${id}`)
            }
            return true
        }

        const recurring = this.recurring.get(id)
        if (recurring && recurring.status === 'pending') {
            recurring.status = 'cancelled'
            this.recurring.delete(id)
            if (this.config.debug) {
                console.log(`[Scheduler] Cancelled recurring message ${id}`)
            }
            return true
        }

        return false
    }

    /**
     * Reschedule a pending message
     *
     * @returns true if rescheduled, false if not found or not pending
     */
    reschedule(id: string, newSendAt: Date): boolean {
        const now = new Date()
        if (newSendAt <= now) {
            throw new Error('newSendAt must be in the future')
        }

        const scheduled = this.scheduled.get(id)
        if (scheduled && scheduled.status === 'pending') {
            // Create new message with updated time (messages are readonly)
            const updated: ScheduledMessage = {
                ...scheduled,
                sendAt: newSendAt,
            }
            this.scheduled.set(id, updated)

            if (this.config.debug) {
                console.log(`[Scheduler] Rescheduled message ${id} to ${newSendAt.toISOString()}`)
            }
            return true
        }

        return false
    }

    /**
     * Get a scheduled message by ID
     */
    get(id: string): ScheduledMessage | RecurringMessage | undefined {
        return this.scheduled.get(id) ?? this.recurring.get(id)
    }

    /**
     * Get all pending scheduled messages
     */
    getPending(): Array<ScheduledMessage | RecurringMessage> {
        const result: Array<ScheduledMessage | RecurringMessage> = []

        for (const msg of this.scheduled.values()) {
            if (msg.status === 'pending') {
                result.push(msg)
            }
        }

        for (const msg of this.recurring.values()) {
            if (msg.status === 'pending') {
                result.push(msg)
            }
        }

        return result.sort((a, b) => {
            const timeA = a.type === 'recurring' ? a.nextSendAt.getTime() : a.sendAt.getTime()
            const timeB = b.type === 'recurring' ? b.nextSendAt.getTime() : b.sendAt.getTime()
            return timeA - timeB
        })
    }

    /**
     * Export all scheduled messages (for persistence)
     */
    export(): {
        scheduled: ScheduledMessage[]
        recurring: RecurringMessage[]
    } {
        return {
            scheduled: Array.from(this.scheduled.values()),
            recurring: Array.from(this.recurring.values()),
        }
    }

    /**
     * Import scheduled messages (for persistence)
     * Only imports pending messages with future send times
     */
    import(data: { scheduled?: ScheduledMessage[]; recurring?: RecurringMessage[] }): {
        imported: number
        skipped: number
    } {
        const now = new Date()
        let imported = 0
        let skipped = 0

        if (data.scheduled) {
            for (const msg of data.scheduled) {
                if (msg.status === 'pending' && new Date(msg.sendAt) > now) {
                    this.scheduled.set(msg.id, {
                        ...msg,
                        sendAt: new Date(msg.sendAt),
                        createdAt: new Date(msg.createdAt),
                    })
                    imported++
                } else {
                    skipped++
                }
            }
        }

        if (data.recurring) {
            for (const msg of data.recurring) {
                const nextSendAt = new Date(msg.nextSendAt)
                if (msg.status === 'pending' && nextSendAt > now) {
                    this.recurring.set(msg.id, {
                        ...msg,
                        sendAt: new Date(msg.sendAt),
                        createdAt: new Date(msg.createdAt),
                        nextSendAt,
                        endAt: msg.endAt ? new Date(msg.endAt) : undefined,
                    })
                    imported++
                } else {
                    skipped++
                }
            }
        }

        if (this.config.debug) {
            console.log(`[Scheduler] Imported ${imported} messages, skipped ${skipped}`)
        }

        return { imported, skipped }
    }

    /**
     * Start the scheduler loop
     */
    private start(): void {
        if (this.intervalHandle) return

        this.intervalHandle = setInterval(() => {
            this.tick().catch((err) => {
                console.error('[Scheduler] Tick error:', err)
            })
        }, this.config.checkInterval)

        if (this.config.debug) {
            console.log(`[Scheduler] Started with ${this.config.checkInterval}ms check interval`)
        }
    }

    /**
     * Process scheduled messages
     */
    private async tick(): Promise<void> {
        if (this.destroyed) return

        const now = new Date()

        // Process one-time messages
        for (const [id, msg] of this.scheduled) {
            if (msg.status === 'pending' && msg.sendAt <= now) {
                // Mark as sending immediately to prevent duplicate sends
                msg.status = 'sent'
                this.scheduled.delete(id)
                await this.sendMessage(msg)
            }
        }

        // Process recurring messages
        for (const [id, msg] of this.recurring) {
            if (msg.status === 'pending' && msg.nextSendAt <= now) {
                // Calculate next time BEFORE sending to prevent race conditions
                const nextTime = calculateNextSendTime(msg.nextSendAt, msg.interval)

                // Update next send time immediately to prevent duplicate sends
                msg.nextSendAt = nextTime

                // Send the message
                await this.sendRecurringMessage(msg)

                // Check if we should stop
                if (msg.endAt && nextTime > msg.endAt) {
                    msg.status = 'sent'
                    this.recurring.delete(id)
                    this.events.onComplete?.(msg)
                    if (this.config.debug) {
                        console.log(`[Scheduler] Recurring message ${id} completed`)
                    }
                }
            }
        }
    }

    /**
     * Send a one-time message
     */
    private async sendMessage(msg: ScheduledMessage): Promise<void> {
        try {
            if (this.config.debug) {
                console.log(`[Scheduler] Sending message ${msg.id}`)
            }

            const result = await this.sdk.send(msg.to, msg.content)
            msg.status = 'sent'
            msg.result = result

            this.events.onSent?.(msg, result)
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            msg.status = 'failed'
            msg.error = error.message

            this.events.onError?.(msg, error)

            if (this.config.debug) {
                console.error(`[Scheduler] Failed to send message ${msg.id}:`, error)
            }
        }
    }

    /**
     * Send a recurring message
     */
    private async sendRecurringMessage(msg: RecurringMessage): Promise<void> {
        try {
            if (this.config.debug) {
                console.log(`[Scheduler] Sending recurring message ${msg.id} (count: ${msg.sendCount + 1})`)
            }

            const result = await this.sdk.send(msg.to, msg.content)
            msg.sendCount++
            msg.result = result

            this.events.onSent?.(msg, result)
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            msg.error = error.message

            this.events.onError?.(msg, error)

            if (this.config.debug) {
                console.error(`[Scheduler] Failed to send recurring message ${msg.id}:`, error)
            }
            // Note: recurring messages continue even if one send fails
        }
    }

    /**
     * Destroy the scheduler and clean up resources
     */
    destroy(): void {
        if (this.destroyed) return

        this.destroyed = true

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle)
            this.intervalHandle = null
        }

        // Cancel all pending messages
        for (const msg of this.scheduled.values()) {
            if (msg.status === 'pending') {
                msg.status = 'cancelled'
            }
        }
        for (const msg of this.recurring.values()) {
            if (msg.status === 'pending') {
                msg.status = 'cancelled'
            }
        }

        this.scheduled.clear()
        this.recurring.clear()

        if (this.config.debug) {
            console.log('[Scheduler] Destroyed')
        }
    }
}
