/**
 * Smart Reminders.
 *
 * A user-friendly facade over MessageScheduler that accepts natural
 * language time expressions for scheduling messages.
 *
 * @example
 * ```ts
 * import { IMessageSDK, Reminders } from '@photon-ai/imessage-kit'
 *
 * const sdk = new IMessageSDK()
 * const reminders = new Reminders(sdk)
 *
 * reminders.in('5 minutes', '+1234567890', 'Time to take a break!')
 * reminders.at('5:30pm', '+1234567890', 'Pick up groceries')
 * reminders.at('tomorrow 9am', '+1234567890', 'Morning standup!')
 * ```
 */

import { MessageScheduler, type SchedulerEvents } from './message-scheduler'
import { parseAtExpression, parseDuration } from './reminder-time'
import type { SendPort } from './send-port'

// -----------------------------------------------
// Types
// -----------------------------------------------

export interface ReminderOptions {
    readonly id?: string
    readonly emoji?: string
}

export interface Reminder {
    readonly id: string
    readonly to: string
    readonly message: string
    readonly scheduledFor: Date
    readonly createdAt: Date
}

// -----------------------------------------------
// Reminders
// -----------------------------------------------

export class Reminders {
    private readonly scheduler: MessageScheduler
    private readonly entries = new Map<string, Reminder>()

    constructor(sender: SendPort, events?: SchedulerEvents) {
        this.scheduler = new MessageScheduler({
            sender,
            tickInterval: 1_000,
            events: {
                onSent: (task, result) => {
                    if (task.status !== 'pending') this.entries.delete(task.id)
                    events?.onSent?.(task, result)
                },
                onError: (task, error) => {
                    if (task.status !== 'pending') this.entries.delete(task.id)
                    events?.onError?.(task, error)
                },
                onComplete: (task) => {
                    this.entries.delete(task.id)
                    events?.onComplete?.(task)
                },
            },
        })

        this.scheduler.start()
    }

    // -----------------------------------------------
    // Schedule
    // -----------------------------------------------

    /** Schedule a reminder relative to now. e.g. "5 minutes", "2 hours" */
    in(duration: string, to: string, message: string, options?: ReminderOptions): string {
        const ms = parseDuration(duration)
        const sendAt = new Date(Date.now() + ms)
        return this.scheduleReminder(to, message, sendAt, options)
    }

    /** Schedule at a natural language time. e.g. "5pm", "tomorrow 9am", "friday 17:30" */
    at(timeExpression: string, to: string, message: string, options?: ReminderOptions): string {
        const sendAt = parseAtExpression(timeExpression)
        return this.scheduleReminder(to, message, sendAt, options)
    }

    /** Schedule at an exact Date. */
    exact(date: Date, to: string, message: string, options?: ReminderOptions): string {
        return this.scheduleReminder(to, message, date, options)
    }

    // -----------------------------------------------
    // Management
    // -----------------------------------------------

    cancel(id: string): boolean {
        const cancelled = this.scheduler.cancel(id)
        if (cancelled) this.entries.delete(id)
        return cancelled
    }

    list(): Reminder[] {
        return Array.from(this.entries.values())
            .filter((r) => this.scheduler.get(r.id)?.status === 'pending')
            .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
    }

    count(): number {
        let count = 0

        for (const r of this.entries.values()) {
            if (this.scheduler.get(r.id)?.status === 'pending') count++
        }

        return count
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    destroy(): void {
        this.scheduler.destroy()
        this.entries.clear()
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private scheduleReminder(to: string, message: string, sendAt: Date, options?: ReminderOptions): string {
        const emoji = options?.emoji ?? '\u23f0'
        const formattedMessage = `${emoji} Reminder: ${message}`

        const id = this.scheduler.schedule({
            id: options?.id,
            to,
            content: formattedMessage,
            sendAt,
        })

        this.entries.set(id, {
            id,
            to,
            message,
            scheduledFor: sendAt,
            createdAt: new Date(),
        })

        return id
    }
}
