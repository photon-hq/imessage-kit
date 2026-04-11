/**
 * Scheduled message delivery.
 *
 * Manages one-time and recurring scheduled sends with a background
 * tick loop. All task state is held in memory.
 */

import { toError } from '../domain/errors'
import { validateRecipient } from '../domain/validate'
import type { SendContent, SendPort, SendResult } from './send-port'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Execution status of a scheduled task. */
export type TaskStatus = 'pending' | 'sent' | 'failed'

/** Recurrence interval for repeating tasks. */
export type RecurrenceInterval = 'hourly' | 'daily' | 'weekly' | 'monthly' | number

/** Common fields shared by all scheduled tasks. */
interface BaseTask {
    readonly id: string
    readonly to: string
    readonly content: SendContent
    readonly sendAt: Date
    readonly status: TaskStatus
    readonly createdAt: Date
    readonly error?: string
}

/** A one-time scheduled send. */
export interface OnceTask extends BaseTask {
    readonly type: 'once'
}

/** A recurring scheduled send. */
export interface RecurringTask extends BaseTask {
    readonly type: 'recurring'
    readonly interval: RecurrenceInterval
    readonly sendCount: number
    readonly nextSendAt: Date
    readonly endAt?: Date
}

/** Discriminated union of all task types. */
export type ScheduledTask = OnceTask | RecurringTask

/** Options for scheduling a one-time message. */
export interface ScheduleOptions {
    readonly to: string
    readonly content: string | SendContent
    readonly sendAt: Date
    readonly id?: string
}

/** Options for scheduling a recurring message. */
export interface RecurringOptions {
    readonly to: string
    readonly content: string | SendContent
    readonly startAt: Date
    readonly interval: RecurrenceInterval
    readonly endAt?: Date
    readonly id?: string
}

/** Scheduler event handlers. */
export interface SchedulerEvents {
    readonly onSent?: (task: ScheduledTask, result: SendResult) => void
    readonly onError?: (task: ScheduledTask, error: Error) => void
    readonly onComplete?: (task: ScheduledTask) => void
}

/** Scheduler construction options. */
export interface SchedulerOptions {
    readonly sender: SendPort
    readonly events?: SchedulerEvents
    readonly tickInterval?: number
    readonly debug?: boolean
}

// -----------------------------------------------
// Helpers
// -----------------------------------------------

function generateId(): string {
    return `sched_${crypto.randomUUID()}`
}

function normalizeContent(content: string | SendContent): SendContent {
    return typeof content === 'string' ? { text: content } : content
}

function validateRecurringInterval(interval: RecurrenceInterval): void {
    if (typeof interval === 'number') {
        if (!Number.isFinite(interval) || interval <= 0) {
            throw new Error('Recurrence interval must be a positive number of milliseconds')
        }

        return
    }

    switch (interval) {
        case 'hourly':
        case 'daily':
        case 'weekly':
        case 'monthly':
            return

        default:
            throw new Error(`Unknown recurrence interval: "${String(interval)}"`)
    }
}

function calculateNextSendTime(current: Date, interval: RecurrenceInterval): Date {
    const next = new Date(current)

    if (typeof interval === 'number') {
        if (!Number.isFinite(interval) || interval <= 0) {
            throw new Error('Recurrence interval must be a positive number of milliseconds')
        }

        next.setTime(next.getTime() + interval)
        return next
    }

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

        case 'monthly': {
            // Advance one month, clamping to the last day when the target
            // day doesn't exist (e.g., Jan 31 → Feb 28 → Mar 28).
            const targetDay = next.getDate()

            next.setMonth(next.getMonth() + 1)

            if (next.getDate() !== targetDay) {
                // JS overshot into the following month. Roll back to last day.
                next.setDate(0)
            }

            break
        }

        default:
            throw new Error(`Unknown recurrence interval: "${String(interval)}"`)
    }

    return next
}

function getEffectiveSendTime(task: ScheduledTask): Date {
    return task.type === 'recurring' ? task.nextSendAt : task.sendAt
}

// -----------------------------------------------
// Scheduler
// -----------------------------------------------

export class MessageScheduler {
    private readonly sender: SendPort
    private readonly events: SchedulerEvents
    private readonly tickInterval: number
    private readonly debug: boolean
    private readonly tasks = new Map<string, ScheduledTask>()

    private intervalHandle: ReturnType<typeof setInterval> | null = null
    private destroyed = false
    private ticking = false

    constructor(options: SchedulerOptions) {
        this.sender = options.sender
        this.events = options.events ?? {}
        this.tickInterval = options.tickInterval ?? 1_000
        this.debug = options.debug ?? false
    }

    // -----------------------------------------------
    // Schedule
    // -----------------------------------------------

    /** Schedule a one-time message. Returns the task id. */
    schedule(options: ScheduleOptions): string {
        this.assertAlive()

        const sendAt = new Date(options.sendAt)
        if (sendAt <= new Date()) {
            throw new Error('sendAt must be in the future')
        }

        validateRecipient(options.to)

        const id = options.id ?? generateId()
        if (this.tasks.has(id)) {
            throw new Error(`Task "${id}" already exists`)
        }

        this.tasks.set(id, {
            id,
            type: 'once',
            to: options.to,
            content: normalizeContent(options.content),
            sendAt,
            status: 'pending',
            createdAt: new Date(),
        })

        this.log(`Scheduled task ${id} for ${sendAt.toISOString()}`)
        return id
    }

    /** Schedule a recurring message. Returns the task id. */
    scheduleRecurring(options: RecurringOptions): string {
        this.assertAlive()

        const startAt = new Date(options.startAt)
        const endAt = options.endAt ? new Date(options.endAt) : undefined

        if (startAt <= new Date()) {
            throw new Error('startAt must be in the future')
        }
        if (endAt && endAt <= startAt) {
            throw new Error('endAt must be after startAt')
        }

        validateRecipient(options.to)
        validateRecurringInterval(options.interval)

        const id = options.id ?? generateId()
        if (this.tasks.has(id)) {
            throw new Error(`Task "${id}" already exists`)
        }

        this.tasks.set(id, {
            id,
            type: 'recurring',
            to: options.to,
            content: normalizeContent(options.content),
            sendAt: startAt,
            status: 'pending',
            createdAt: new Date(),
            interval: options.interval,
            endAt,
            sendCount: 0,
            nextSendAt: new Date(startAt),
        })

        this.log(`Scheduled recurring task ${id} starting ${startAt.toISOString()}`)
        return id
    }

    // -----------------------------------------------
    // Management
    // -----------------------------------------------

    /** Cancel a pending task. Returns true if cancelled. */
    cancel(id: string): boolean {
        const task = this.tasks.get(id)
        if (!task || task.status !== 'pending') return false

        this.tasks.delete(id)
        this.log(`Cancelled task ${id}`)
        return true
    }

    /** Reschedule a pending one-time task. Returns true if rescheduled. */
    reschedule(id: string, newSendAt: Date): boolean {
        if (newSendAt <= new Date()) {
            throw new Error('newSendAt must be in the future')
        }

        const task = this.tasks.get(id)
        if (!task || task.status !== 'pending' || task.type !== 'once') return false

        this.tasks.set(id, { ...task, sendAt: new Date(newSendAt) })
        this.log(`Rescheduled task ${id} to ${newSendAt.toISOString()}`)
        return true
    }

    /** Get a task by id. */
    get(id: string): ScheduledTask | undefined {
        return this.tasks.get(id)
    }

    /** List all pending tasks sorted by send time ascending. */
    getPending(): ScheduledTask[] {
        const pending: ScheduledTask[] = []

        for (const task of this.tasks.values()) {
            if (task.status === 'pending') pending.push(task)
        }

        return pending.sort((a, b) => getEffectiveSendTime(a).getTime() - getEffectiveSendTime(b).getTime())
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    /** Start the background delivery loop. */
    start(): void {
        this.assertAlive()
        if (this.intervalHandle) return

        this.intervalHandle = setInterval(() => {
            this.tick().catch((err) => {
                if (this.debug) console.error('[MessageScheduler] Tick error:', err)
            })
        }, this.tickInterval)

        this.intervalHandle.unref?.()
        this.log(`Started with ${this.tickInterval}ms interval`)
    }

    /** Stop the tick loop and discard all tasks. */
    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle)
            this.intervalHandle = null
        }

        this.tasks.clear()
        this.log('Destroyed')
    }

    // -----------------------------------------------
    // Tick
    // -----------------------------------------------

    private async tick(): Promise<void> {
        if (this.destroyed || this.ticking) return
        this.ticking = true

        try {
            const now = new Date()
            const due: ScheduledTask[] = []

            for (const task of this.tasks.values()) {
                if (task.status === 'pending' && getEffectiveSendTime(task) <= now) {
                    due.push(task)
                }
            }

            for (const task of due) {
                if (!this.tasks.has(task.id)) continue

                if (task.type === 'once') {
                    await this.sendOnce(task)
                } else {
                    await this.sendRecurring(task)
                }
            }
        } finally {
            this.ticking = false
        }
    }

    // -----------------------------------------------
    // Send
    // -----------------------------------------------

    private async sendOnce(task: OnceTask): Promise<void> {
        try {
            this.log(`Sending task ${task.id}`)
            const result = await this.sender.send({ to: task.to, ...task.content })

            if (this.tasks.has(task.id)) {
                this.tasks.delete(task.id)
                this.emitSent({ ...task, status: 'sent' }, result)
            }
        } catch (err) {
            const error = toError(err)
            if (this.tasks.has(task.id)) {
                this.tasks.delete(task.id)
                this.emitError({ ...task, status: 'failed', error: error.message }, error)
            }
        }
    }

    private async sendRecurring(task: RecurringTask): Promise<void> {
        const nextTime = calculateNextSendTime(task.nextSendAt, task.interval)
        const isComplete = task.endAt != null && nextTime > task.endAt

        try {
            this.log(`Sending recurring task ${task.id} (count: ${task.sendCount + 1})`)
            const result = await this.sender.send({ to: task.to, ...task.content })

            if (!this.tasks.has(task.id)) return

            const updated: RecurringTask = {
                ...task,
                sendCount: task.sendCount + 1,
                nextSendAt: nextTime,
                error: undefined,
            }

            if (isComplete) {
                this.tasks.delete(task.id)
                this.emitSent({ ...updated, status: 'sent' }, result)
                this.emitComplete(updated)
                this.log(`Recurring task ${task.id} completed`)
            } else {
                this.tasks.set(task.id, updated)
                this.emitSent(updated, result)
            }
        } catch (err) {
            const error = toError(err)

            if (!this.tasks.has(task.id)) return

            if (isComplete) {
                this.tasks.delete(task.id)
                this.emitError({ ...task, status: 'failed', error: error.message }, error)
            } else {
                this.tasks.set(task.id, { ...task, error: error.message, nextSendAt: nextTime })
                this.emitError(task, error)
            }
        }
    }

    // -----------------------------------------------
    // Events
    // -----------------------------------------------

    private emitSent(task: ScheduledTask, result: SendResult): void {
        try {
            this.events.onSent?.(task, result)
        } catch (err) {
            if (this.debug) console.error('[MessageScheduler] onSent callback error:', err)
        }
    }

    private emitError(task: ScheduledTask, error: Error): void {
        try {
            this.events.onError?.(task, error)
        } catch (err) {
            if (this.debug) console.error('[MessageScheduler] onError callback error:', err)
        }
    }

    private emitComplete(task: ScheduledTask): void {
        try {
            this.events.onComplete?.(task)
        } catch (err) {
            if (this.debug) console.error('[MessageScheduler] onComplete callback error:', err)
        }
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private assertAlive(): void {
        if (this.destroyed) throw new Error('Scheduler has been destroyed')
    }

    private log(msg: string): void {
        if (this.debug) console.log(`[MessageScheduler] ${msg}`)
    }
}
