/**
 * Smart Reminders
 *
 * A user-friendly wrapper around MessageScheduler for setting reminders
 * with natural time expressions.
 *
 * @example
 * ```ts
 * import { IMessageSDK, Reminders } from '@photon-ai/imessage-kit'
 *
 * const sdk = new IMessageSDK()
 * const reminders = new Reminders(sdk)
 *
 * // Set reminders with human-readable times
 * reminders.in('5 minutes', '+1234567890', 'Time to take a break!')
 * reminders.in('2 hours', '+1234567890', 'Call the client')
 * reminders.at('5:30pm', '+1234567890', 'Pick up groceries')
 * reminders.at('tomorrow 9am', '+1234567890', 'Morning standup!')
 *
 * // List and manage reminders
 * reminders.list()
 * reminders.cancel('reminder-id')
 * ```
 */

import type { IMessageSDK } from '../core/sdk'
import { MessageScheduler, type SchedulerEvents } from './scheduler'

export interface ReminderOptions {
    /** Optional custom ID */
    id?: string
    /** Optional emoji prefix (default: ⏰) */
    emoji?: string
}

export interface Reminder {
    id: string
    to: string
    message: string
    scheduledFor: Date
    createdAt: Date
}

/**
 * Parse human-readable duration strings
 * Supports: "5 minutes", "2 hours", "1 day", "30 seconds", "1 week"
 */
function parseDuration(duration: string): number {
    const match = duration.toLowerCase().match(/^(\d+)\s*(second|minute|hour|day|week)s?$/)
    if (!match) {
        throw new Error(`Invalid duration format: "${duration}". Use formats like "5 minutes", "2 hours", "1 day"`)
    }

    const value = parseInt(match[1]!, 10)
    const unit = match[2]!

    const multipliers: Record<string, number> = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
    }

    return value * multipliers[unit]!
}

/**
 * Parse time expressions like "5pm", "17:30", "5:30pm"
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
    // Handle 24-hour format: "17:30"
    const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/)
    if (match24) {
        return { hours: parseInt(match24[1]!, 10), minutes: parseInt(match24[2]!, 10) }
    }

    // Handle 12-hour format: "5pm", "5:30pm", "5:30 pm"
    const match12 = timeStr.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
    if (match12) {
        let hours = parseInt(match12[1]!, 10)
        const minutes = match12[2] ? parseInt(match12[2], 10) : 0
        const period = match12[3]!

        if (period === 'pm' && hours !== 12) hours += 12
        if (period === 'am' && hours === 12) hours = 0

        return { hours, minutes }
    }

    throw new Error(`Invalid time format: "${timeStr}". Use formats like "5pm", "5:30pm", "17:30"`)
}

/**
 * Parse "at" expressions: "5pm", "tomorrow 9am", "friday 2pm"
 */
function parseAtExpression(expression: string): Date {
    const now = new Date()
    const parts = expression.toLowerCase().trim().split(/\s+/)

    let targetDate = new Date(now)
    let timeStr: string

    if (parts.length === 1) {
        // Just time: "5pm"
        timeStr = parts[0]!
    } else if (parts[0] === 'tomorrow') {
        // "tomorrow 9am"
        targetDate.setDate(targetDate.getDate() + 1)
        timeStr = parts.slice(1).join(' ')
    } else if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(parts[0]!)) {
        // "friday 2pm"
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        const targetDay = days.indexOf(parts[0]!)
        const currentDay = now.getDay()
        let daysUntil = targetDay - currentDay
        if (daysUntil <= 0) daysUntil += 7
        targetDate.setDate(targetDate.getDate() + daysUntil)
        timeStr = parts.slice(1).join(' ')
    } else {
        // Assume it's just a time
        timeStr = expression
    }

    const { hours, minutes } = parseTime(timeStr)
    targetDate.setHours(hours, minutes, 0, 0)

    // If the time is in the past today, move to tomorrow
    if (targetDate <= now) {
        targetDate.setDate(targetDate.getDate() + 1)
    }

    return targetDate
}

/**
 * Smart Reminders - Human-friendly message scheduling
 */
export class Reminders {
    private readonly scheduler: MessageScheduler
    private readonly reminders: Map<string, Reminder> = new Map()

    constructor(
        sdk: IMessageSDK,
        events?: SchedulerEvents
    ) {
        this.scheduler = new MessageScheduler(
            sdk,
            { checkInterval: 1000, debug: false },
            {
                onSent: (msg, result) => {
                    events?.onSent?.(msg, result)
                },
                onError: (msg, error) => {
                    events?.onError?.(msg, error)
                },
            }
        )
    }

    /**
     * Set a reminder for X time from now
     *
     * @example
     * ```ts
     * reminders.in('5 minutes', '+1234567890', 'Take a break!')
     * reminders.in('2 hours', '+1234567890', 'Call mom')
     * reminders.in('1 day', '+1234567890', 'Follow up on email')
     * ```
     */
    in(duration: string, to: string, message: string, options?: ReminderOptions): string {
        const ms = parseDuration(duration)
        const sendAt = new Date(Date.now() + ms)
        return this.scheduleReminder(to, message, sendAt, options)
    }

    /**
     * Set a reminder for a specific time
     *
     * @example
     * ```ts
     * reminders.at('5pm', '+1234567890', 'End of day review')
     * reminders.at('tomorrow 9am', '+1234567890', 'Morning standup')
     * reminders.at('friday 2pm', '+1234567890', 'Weekly sync')
     * ```
     */
    at(timeExpression: string, to: string, message: string, options?: ReminderOptions): string {
        const sendAt = parseAtExpression(timeExpression)
        return this.scheduleReminder(to, message, sendAt, options)
    }

    /**
     * Set a reminder for an exact date/time
     */
    exact(date: Date, to: string, message: string, options?: ReminderOptions): string {
        return this.scheduleReminder(to, message, date, options)
    }

    private scheduleReminder(to: string, message: string, sendAt: Date, options?: ReminderOptions): string {
        const emoji = options?.emoji ?? '⏰'
        const formattedMessage = `${emoji} Reminder: ${message}`

        const id = this.scheduler.schedule({
            id: options?.id,
            to,
            content: formattedMessage,
            sendAt,
        })

        this.reminders.set(id, {
            id,
            to,
            message,
            scheduledFor: sendAt,
            createdAt: new Date(),
        })

        return id
    }

    /**
     * Cancel a reminder by ID
     */
    cancel(id: string): boolean {
        const cancelled = this.scheduler.cancel(id)
        if (cancelled) {
            this.reminders.delete(id)
        }
        return cancelled
    }

    /**
     * Get a reminder by ID
     */
    get(id: string): Reminder | undefined {
        return this.reminders.get(id)
    }

    /**
     * List all pending reminders
     */
    list(): Reminder[] {
        return Array.from(this.reminders.values())
            .filter(r => this.scheduler.get(r.id)?.status === 'pending')
            .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
    }

    /**
     * Get count of pending reminders
     */
    count(): number {
        return this.list().length
    }

    /**
     * Destroy the reminder system
     */
    destroy(): void {
        this.scheduler.destroy()
        this.reminders.clear()
    }
}
