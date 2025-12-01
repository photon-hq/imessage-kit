/**
 * Message Scheduler Tests
 *
 * Tests for the MessageScheduler utility
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { IMessageSDK } from '../src/core/sdk'
import type { SendResult } from '../src/core/sender'
import {
    MessageScheduler,
    type RecurringMessage,
    type ScheduledMessage,
    type SchedulerEvents,
} from '../src/utils/scheduler'
import { createSpy, waitFor } from './setup'

/**
 * Create a mock SDK for testing
 */
function createMockSDK(sendImpl?: (to: string, content: any) => Promise<SendResult>) {
    const defaultSend = async (): Promise<SendResult> => ({ sentAt: new Date() })
    const sendSpy = createSpy(sendImpl ?? defaultSend)

    return {
        sdk: {
            send: sendSpy.fn,
        } as unknown as IMessageSDK,
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
            scheduler = new MessageScheduler(mockSDK.sdk)
            expect(scheduler).toBeInstanceOf(MessageScheduler)
        })

        it('should accept custom config', () => {
            scheduler = new MessageScheduler(mockSDK.sdk, {
                checkInterval: 500,
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
            scheduler = new MessageScheduler(mockSDK.sdk, {}, events)
            expect(scheduler).toBeInstanceOf(MessageScheduler)
        })
    })

    describe('schedule', () => {
        it('should schedule a one-time message', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            expect(id).toMatch(/^sched_/)
            expect(scheduler.get(id)).toBeDefined()
        })

        it('should accept custom ID', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const id = scheduler.schedule({
                id: 'my-custom-id',
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            expect(id).toBe('my-custom-id')
        })

        it('should throw if sendAt is in the past', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            expect(() =>
                scheduler.schedule({
                    to: '+1234567890',
                    content: 'Hello!',
                    sendAt: new Date(Date.now() - 1000),
                })
            ).toThrow('sendAt must be in the future')
        })

        it('should throw if ID already exists', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk)
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
            scheduler = new MessageScheduler(mockSDK.sdk)

            const id = scheduler.schedule({
                to: '+1234567890',
                content: { text: 'Hello!', images: ['/path/to/image.jpg'] },
                sendAt: new Date(Date.now() + 60000),
            })

            const msg = scheduler.get(id) as ScheduledMessage
            expect(msg.content).toEqual({ text: 'Hello!', images: ['/path/to/image.jpg'] })
        })
    })

    describe('scheduleRecurring', () => {
        it('should schedule a recurring message', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const id = scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Daily reminder',
                startAt: new Date(Date.now() + 60000),
                interval: 'daily',
            })

            expect(id).toMatch(/^sched_/)
            const msg = scheduler.get(id) as RecurringMessage
            expect(msg.type).toBe('recurring')
            expect(msg.interval).toBe('daily')
        })

        it('should support all interval types', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const intervals = ['hourly', 'daily', 'weekly', 'monthly', 3600000] as const

            for (const interval of intervals) {
                const id = scheduler.scheduleRecurring({
                    to: '+1234567890',
                    content: `Interval: ${interval}`,
                    startAt: new Date(Date.now() + 60000),
                    interval: interval as any,
                })

                const msg = scheduler.get(id) as RecurringMessage
                expect(msg.interval).toBe(interval)
            }
        })

        it('should accept endAt', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const endAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 1 week
            const id = scheduler.scheduleRecurring({
                to: '+1234567890',
                content: 'Limited',
                startAt: new Date(Date.now() + 60000),
                interval: 'daily',
                endAt,
            })

            const msg = scheduler.get(id) as RecurringMessage
            expect(msg.endAt?.getTime()).toBe(endAt.getTime())
        })

        it('should throw if startAt is in the past', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk)

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
    })

    describe('cancel', () => {
        it('should cancel a scheduled message', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk)

            const cancelled = scheduler.cancel('non-existent')

            expect(cancelled).toBe(false)
        })
    })

    describe('reschedule', () => {
        it('should reschedule a pending message', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            const newTime = new Date(Date.now() + 120000)
            const rescheduled = scheduler.reschedule(id, newTime)

            expect(rescheduled).toBe(true)
            const msg = scheduler.get(id) as ScheduledMessage
            expect(msg.sendAt.getTime()).toBe(newTime.getTime())
        })

        it('should throw if new time is in the past', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            expect(() => scheduler.reschedule(id, new Date(Date.now() - 1000))).toThrow('must be in the future')
        })

        it('should return false for non-existent message', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const rescheduled = scheduler.reschedule('non-existent', new Date(Date.now() + 60000))

            expect(rescheduled).toBe(false)
        })
    })

    describe('get', () => {
        it('should return scheduled message by ID', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk)

            const msg = scheduler.get('non-existent')

            expect(msg).toBeUndefined()
        })
    })

    describe('getPending', () => {
        it('should return all pending messages sorted by time', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk, { checkInterval: 50 })

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

            scheduler = new MessageScheduler(mockSDK.sdk, { checkInterval: 50 }, { onSent: onSentSpy.fn })

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

            scheduler = new MessageScheduler(failingSDK.sdk, { checkInterval: 50 }, { onError: onErrorSpy.fn })

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
            scheduler = new MessageScheduler(mockSDK.sdk, { checkInterval: 50 })

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
            const onCompleteSpy = createSpy<(msg: RecurringMessage) => void>()

            scheduler = new MessageScheduler(mockSDK.sdk, { checkInterval: 50 }, { onComplete: onCompleteSpy.fn })

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
    })

    describe('export/import', () => {
        it('should export scheduled messages', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            scheduler.schedule({
                id: 'once-1',
                to: '+1234567890',
                content: 'One-time',
                sendAt: new Date(Date.now() + 60000),
            })

            scheduler.scheduleRecurring({
                id: 'recurring-1',
                to: '+1234567890',
                content: 'Recurring',
                startAt: new Date(Date.now() + 60000),
                interval: 'daily',
            })

            const exported = scheduler.export()

            expect(exported.scheduled.length).toBe(1)
            expect(exported.recurring.length).toBe(1)
            expect(exported.scheduled[0]?.id).toBe('once-1')
            expect(exported.recurring[0]?.id).toBe('recurring-1')
        })

        it('should import scheduled messages', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const futureTime = new Date(Date.now() + 60000)

            const result = scheduler.import({
                scheduled: [
                    {
                        id: 'imported-once',
                        type: 'once',
                        to: '+1234567890',
                        content: 'Imported',
                        sendAt: futureTime,
                        status: 'pending',
                        createdAt: new Date(),
                    },
                ],
                recurring: [
                    {
                        id: 'imported-recurring',
                        type: 'recurring',
                        to: '+1234567890',
                        content: 'Imported recurring',
                        sendAt: futureTime,
                        nextSendAt: futureTime,
                        interval: 'daily',
                        status: 'pending',
                        createdAt: new Date(),
                        sendCount: 0,
                    },
                ],
            })

            expect(result.imported).toBe(2)
            expect(result.skipped).toBe(0)
            expect(scheduler.get('imported-once')).toBeDefined()
            expect(scheduler.get('imported-recurring')).toBeDefined()
        })

        it('should skip past messages during import', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const pastTime = new Date(Date.now() - 60000)

            const result = scheduler.import({
                scheduled: [
                    {
                        id: 'past-message',
                        type: 'once',
                        to: '+1234567890',
                        content: 'Past',
                        sendAt: pastTime,
                        status: 'pending',
                        createdAt: new Date(),
                    },
                ],
            })

            expect(result.imported).toBe(0)
            expect(result.skipped).toBe(1)
            expect(scheduler.get('past-message')).toBeUndefined()
        })

        it('should skip already sent/failed messages during import', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            const futureTime = new Date(Date.now() + 60000)

            const result = scheduler.import({
                scheduled: [
                    {
                        id: 'sent-message',
                        type: 'once',
                        to: '+1234567890',
                        content: 'Sent',
                        sendAt: futureTime,
                        status: 'sent',
                        createdAt: new Date(),
                    },
                    {
                        id: 'failed-message',
                        type: 'once',
                        to: '+1234567890',
                        content: 'Failed',
                        sendAt: futureTime,
                        status: 'failed',
                        createdAt: new Date(),
                    },
                ],
            })

            expect(result.imported).toBe(0)
            expect(result.skipped).toBe(2)
        })
    })

    describe('destroy', () => {
        it('should stop scheduler', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

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
            scheduler = new MessageScheduler(mockSDK.sdk)

            const id = scheduler.schedule({
                to: '+1234567890',
                content: 'Hello!',
                sendAt: new Date(Date.now() + 60000),
            })

            scheduler.destroy()

            expect(scheduler.get(id)).toBeUndefined()
        })

        it('should be idempotent', () => {
            scheduler = new MessageScheduler(mockSDK.sdk)

            scheduler.destroy()
            scheduler.destroy() // Should not throw
        })
    })
})
