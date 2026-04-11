/**
 * Message Scheduler Tests
 *
 * Tests for the MessageScheduler utility
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
    MessageScheduler,
    type OnceTask,
    type RecurringTask,
    type ScheduledTask,
    type SchedulerEvents,
} from '../src/application/message-scheduler'
import type { SendPort } from '../src/application/send-port'
import type { SendRequest, SendResult } from '../src/types/send'
import { createSpy, waitFor } from './setup'

/**
 * Create a mock SDK for testing
 */
function createMockSDK(sendImpl?: (request: SendRequest) => Promise<SendResult>) {
    const defaultSend = async (): Promise<SendResult> => ({ status: 'sent', sentAt: new Date() })
    const sendSpy = createSpy(sendImpl ?? defaultSend)

    return {
        sdk: {
            send: sendSpy.fn,
        } as SendPort,
        sendSpy,
    }
}

describe('MessageScheduler', () => {
    let scheduler: MessageScheduler
    let mockSDK: ReturnType<typeof createMockSDK>

    beforeEach(() => {
        mockSDK = createMockSDK()
    })

    afterEach(() => {
        scheduler?.destroy()
    })

    describe('Constructor', () => {
        it('should create scheduler with default config', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })
            expect(scheduler).toBeInstanceOf(MessageScheduler)
        })

        it('should accept custom config', () => {
            scheduler = new MessageScheduler({
                sender: mockSDK.sdk,
                tickInterval: 500,
                debug: true,
            })
            expect(scheduler).toBeInstanceOf(MessageScheduler)
        })

        it('should accept event callbacks', () => {
            const events: SchedulerEvents = {
                onSent: () => {},
                onError: () => {},
                onComplete: () => {},
            }
            scheduler = new MessageScheduler({ sender: mockSDK.sdk, events })
            expect(scheduler).toBeInstanceOf(MessageScheduler)
        })
    })

    describe('schedule', () => {
        it('should schedule a one-time message', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            expect(id).toMatch(/^sched_/)
            expect(scheduler.get(id)).toBeDefined()
        })

        it('should accept custom ID', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                id: 'my-custom-id',
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            expect(id).toBe('my-custom-id')
        })

        it('should throw if sendAt is in the past', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            expect(() =>
                scheduler.schedule({
                    to: '+1234567890',
                    content: 'Hello!',
                    sendAt: new Date(Date.now() - 1000),
                })
            ).toThrow('sendAt must be in the future')
        })

        it('should throw if ID already exists', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            scheduler.schedule({
                id: 'duplicate',
                to: '+1234567890',
                content: 'First',
                sendAt: new Date(Date.now() + 60000),
            })

            expect(() =>
                scheduler.schedule({
                    id: 'duplicate',
                    to: '+1234567890',
                    content: 'Second',
                    sendAt: new Date(Date.now() + 60000),
                })
            ).toThrow('already exists')
        })

        it('should throw if scheduler is destroyed', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })
            scheduler.destroy()

            expect(() =>
                scheduler.schedule({
                    to: '+1234567890',
                    content: 'Hello!',
                    sendAt: new Date(Date.now() + 60000),
                })
            ).toThrow('destroyed')
        })

        it('should schedule message with object content', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                to: '+1234567890',
                content: { text: 'Hello!', attachments: ['/path/to/image.jpg'] },
                sendAt: new Date(Date.now() + 60000),
            })

            const msg = scheduler.get(id) as OnceTask
            expect(msg.content).toEqual({ text: 'Hello!', attachments: ['/path/to/image.jpg'] })
        })
    })

    describe('scheduleRecurring', () => {
        it('should schedule a recurring message', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Daily reminder',
                startAt: new Date(Date.now() + 60000),
                interval: 'daily',
            })

            expect(id).toMatch(/^sched_/)
            const msg = scheduler.get(id) as RecurringTask
            expect(msg.type).toBe('recurring')
            expect(msg.interval).toBe('daily')
        })

        it('should support all interval types', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const intervals = ['hourly', 'daily', 'weekly', 'monthly', 3600000] as const

            for (const interval of intervals) {
                const id = scheduler.scheduleRecurring({
                    to: '+1234567890',
                    content: `Interval: ${interval}`,
                    startAt: new Date(Date.now() + 60000),
                    interval: interval as any,
                })

                const msg = scheduler.get(id) as RecurringTask
                expect(msg.interval).toBe(interval)
            }
        })

        it('should accept endAt', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const endAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 1 week
            const id = scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Limited',
                startAt: new Date(Date.now() + 60000),
                interval: 'daily',
                endAt,
            })

            const msg = scheduler.get(id) as RecurringTask
            expect(msg.endAt?.getTime()).toBe(endAt.getTime())
        })

        it('should throw if startAt is in the past', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            expect(() =>
                scheduler.scheduleRecurring({
                    to: '+1234567890',
                    content: 'Hello!',
                    startAt: new Date(Date.now() - 1000),
                    interval: 'daily',
                })
            ).toThrow('startAt must be in the future')
        })

        it('should throw if endAt is before startAt', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            expect(() =>
                scheduler.scheduleRecurring({
                    to: '+1234567890',
                    content: 'Hello!',
                    startAt: new Date(Date.now() + 60000),
                    interval: 'daily',
                    endAt: new Date(Date.now() + 30000),
                })
            ).toThrow('endAt must be after startAt')
        })

        it('should throw if numeric interval is not a positive finite number', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            expect(() =>
                scheduler.scheduleRecurring({
                    to: '+1234567890',
                    content: 'Hello!',
                    startAt: new Date(Date.now() + 60000),
                    interval: 0,
                })
            ).toThrow('Recurrence interval must be a positive number of milliseconds')

            expect(() =>
                scheduler.scheduleRecurring({
                    to: '+1234567890',
                    content: 'Hello!',
                    startAt: new Date(Date.now() + 60000),
                    interval: Number.NaN,
                })
            ).toThrow('Recurrence interval must be a positive number of milliseconds')
        })

        it('should throw if string interval is unsupported at runtime', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            expect(() =>
                scheduler.scheduleRecurring({
                    to: '+1234567890',
                    content: 'Hello!',
                    startAt: new Date(Date.now() + 60000),
                    interval: 'yearly' as never,
                })
            ).toThrow('Unknown recurrence interval: "yearly"')
        })
    })

    describe('cancel', () => {
        it('should cancel a scheduled message', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            const cancelled = scheduler.cancel(id)

            expect(cancelled).toBe(true)
            expect(scheduler.get(id)).toBeUndefined()
        })

        it('should cancel a recurring message', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Hello!',
                startAt: new Date(Date.now() + 60000),
                interval: 'daily',
            })

            const cancelled = scheduler.cancel(id)

            expect(cancelled).toBe(true)
            expect(scheduler.get(id)).toBeUndefined()
        })

        it('should return false for non-existent message', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const cancelled = scheduler.cancel('non-existent')

            expect(cancelled).toBe(false)
        })
    })

    describe('reschedule', () => {
        it('should reschedule a pending message', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            const newTime = new Date(Date.now() + 120000)
            const rescheduled = scheduler.reschedule(id, newTime)

            expect(rescheduled).toBe(true)
            const msg = scheduler.get(id) as OnceTask
            expect(msg.sendAt.getTime()).toBe(newTime.getTime())
        })

        it('should throw if new time is in the past', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            expect(() => scheduler.reschedule(id, new Date(Date.now() - 1000))).toThrow('must be in the future')
        })

        it('should return false for non-existent message', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const rescheduled = scheduler.reschedule('non-existent', new Date(Date.now() + 60000))

            expect(rescheduled).toBe(false)
        })
    })

    describe('get', () => {
        it('should return scheduled message by ID', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            const msg = scheduler.get(id)

            expect(msg).toBeDefined()
            expect(msg?.id).toBe(id)
            expect(msg?.to).toBe('+1234567890')
        })

        it('should return undefined for non-existent ID', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const msg = scheduler.get('non-existent')

            expect(msg).toBeUndefined()
        })
    })

    describe('getPending', () => {
        it('should return all pending messages sorted by time', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id1 = scheduler.schedule({
                to: '+1111111111',
                content: 'Later',
                sendAt: new Date(Date.now() + 120000),
            })

            const id2 = scheduler.schedule({
                to: '+2222222222',
                content: 'Sooner',
                sendAt: new Date(Date.now() + 60000),
            })

            const pending = scheduler.getPending()

            expect(pending.length).toBe(2)
            expect(pending[0]?.id).toBe(id2) // Sooner first
            expect(pending[1]?.id).toBe(id1) // Later second
        })

        it('should include recurring messages', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            scheduler.schedule({
                to: '+1111111111',
                content: 'One-time',
                sendAt: new Date(Date.now() + 60000),
            })

            scheduler.scheduleRecurring({
                to: '+2222222222',
                content: 'Recurring',
                startAt: new Date(Date.now() + 30000),
                interval: 'daily',
            })

            const pending = scheduler.getPending()

            expect(pending.length).toBe(2)
            expect(pending[0]?.type).toBe('recurring')
            expect(pending[1]?.type).toBe('once')
        })
    })

    describe('Message Sending', () => {
        it('should send message when time arrives', async () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk, tickInterval: 50 })
            scheduler.start()

            scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 100),
            })

            await waitFor(() => mockSDK.sendSpy.callCount() === 1, 2000)

            expect(mockSDK.sendSpy.callCount()).toBe(1)
        })

        it('should call onSent callback', async () => {
            const onSentSpy = createSpy<(msg: any, result: SendResult) => void>()

            scheduler = new MessageScheduler({
                sender: mockSDK.sdk,
                tickInterval: 50,
                events: { onSent: onSentSpy.fn },
            })
            scheduler.start()

            scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 100),
            })

            await waitFor(() => onSentSpy.callCount() === 1, 2000)

            expect(onSentSpy.callCount()).toBe(1)
        })

        it('should call onError callback on failure', async () => {
            const failingSDK = createMockSDK(async () => {
                throw new Error('Send failed')
            })

            const onErrorSpy = createSpy<(msg: any, error: Error) => void>()

            scheduler = new MessageScheduler({
                sender: failingSDK.sdk,
                tickInterval: 50,
                events: { onError: onErrorSpy.fn },
            })
            scheduler.start()

            scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 100),
            })

            await waitFor(() => onErrorSpy.callCount() === 1, 2000)

            expect(onErrorSpy.callCount()).toBe(1)
            expect(onErrorSpy.calls[0]?.args[1].message).toBe('Send failed')
        })

        it('should send recurring messages multiple times', async () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk, tickInterval: 50 })
            scheduler.start()

            scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Recurring',
                startAt: new Date(Date.now() + 100),
                interval: 200, // 200ms interval
                endAt: new Date(Date.now() + 600), // End after ~2-3 sends
            })

            await waitFor(() => mockSDK.sendSpy.callCount() >= 2, 3000)

            expect(mockSDK.sendSpy.callCount()).toBeGreaterThanOrEqual(2)
        })

        it('should call onComplete when recurring message ends', async () => {
            const onCompleteSpy = createSpy<(msg: RecurringTask) => void>()

            scheduler = new MessageScheduler({
                sender: mockSDK.sdk,
                tickInterval: 50,
                events: { onComplete: onCompleteSpy.fn },
            })
            scheduler.start()

            scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Recurring',
                startAt: new Date(Date.now() + 100),
                interval: 150,
                endAt: new Date(Date.now() + 300),
            })

            await waitFor(() => onCompleteSpy.callCount() === 1, 3000)

            expect(onCompleteSpy.callCount()).toBe(1)
        })

        it('should not mark the schedule complete when the final recurring send fails', async () => {
            const failingSDK = createMockSDK(async () => {
                throw new Error('Send failed')
            })
            const onCompleteSpy = createSpy<(msg: RecurringTask) => void>()
            const onErrorSpy = createSpy<(msg: RecurringTask, error: Error) => void>()

            scheduler = new MessageScheduler({
                sender: failingSDK.sdk,
                tickInterval: 50,
                events: {
                    onComplete: onCompleteSpy.fn,
                    onError: onErrorSpy.fn,
                },
            })
            scheduler.start()

            const id = scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Recurring',
                startAt: new Date(Date.now() + 100),
                interval: 150,
                endAt: new Date(Date.now() + 300),
            })

            // When all sends fail and endAt is reached, the task is deleted from the map
            // and onError is emitted (but NOT onComplete)
            await waitFor(() => onErrorSpy.callCount() >= 1 && scheduler.get(id) === undefined, 3000)

            expect(onCompleteSpy.callCount()).toBe(0)
            expect(onErrorSpy.callCount()).toBeGreaterThanOrEqual(1)
            // Task is deleted from map after terminal failure
            expect(scheduler.get(id)).toBeUndefined()
        })

        it('should isolate scheduler state from throwing event callbacks', async () => {
            const onSentSpy = createSpy<(msg: ScheduledTask, result: SendResult) => void>(() => {
                throw new Error('onSent exploded')
            })
            const onErrorSpy = createSpy<(msg: ScheduledTask, error: Error) => void>()

            scheduler = new MessageScheduler({
                sender: mockSDK.sdk,
                tickInterval: 50,
                events: {
                    onSent: onSentSpy.fn,
                    onError: onErrorSpy.fn,
                },
            })
            scheduler.start()

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 100),
            })

            await waitFor(() => mockSDK.sendSpy.callCount() === 1, 2000)

            expect(onSentSpy.callCount()).toBe(1)
            expect(onErrorSpy.callCount()).toBe(0)
            expect(scheduler.get(id)).toBeUndefined()
        })
    })

    describe('destroy', () => {
        it('should stop scheduler', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            scheduler.destroy()

            // Should not throw when accessing after destroy
            expect(scheduler.getPending()).toEqual([])
        })

        it('should cancel all pending messages', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            scheduler.destroy()

            expect(scheduler.get(id)).toBeUndefined()
        })

        it('should be idempotent', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            scheduler.destroy()
            scheduler.destroy() // Should not throw
        })

        it('should not allow restart after destroy', () => {
            scheduler = new MessageScheduler({ sender: mockSDK.sdk })

            scheduler.destroy()

            expect(() => scheduler.start()).toThrow('Scheduler has been destroyed')
        })
    })
})
