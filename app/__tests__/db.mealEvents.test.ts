import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import {
    claimMealWindow,
    computeMealKey,
    findByMealKey,
    findPendingPostsBefore,
    findRecentForHandle,
    markPostSent,
    markPreSent,
    recordUserReply,
} from '../src/db/mealEvents'
import { createMemoryClient } from '../src/db/sheets'

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    return client
}

describe('mealEvents repo', () => {
    it('computes a deterministic 16-char meal_key', () => {
        const k1 = computeMealKey('+14155550123', '2026-04-24', 'Lunch')
        const k2 = computeMealKey('+14155550123', '2026-04-24', 'Lunch')
        const k3 = computeMealKey('+14155550123', '2026-04-24', 'Dinner')
        expect(k1).toHaveLength(16)
        expect(k1).toBe(k2)
        expect(k1).not.toBe(k3)
    })

    it('claimMealWindow inserts once and returns null on re-claim', async () => {
        const client = await setup()
        const first = await claimMealWindow(client, {
            handle: '+14155550123',
            scheduleId: 's1',
            venueId: 'auto',
            date: '2026-04-24',
            mealLabel: 'Lunch',
            startIso: '2026-04-24T16:00:00Z',
            endIso: '2026-04-24T19:00:00Z',
        })
        expect(first).not.toBeNull()
        const second = await claimMealWindow(client, {
            handle: '+14155550123',
            scheduleId: 's1',
            venueId: 'auto',
            date: '2026-04-24',
            mealLabel: 'Lunch',
            startIso: '2026-04-24T16:00:00Z',
            endIso: '2026-04-24T19:00:00Z',
        })
        expect(second).toBeNull()
    })

    it('marks pre and post sent', async () => {
        const client = await setup()
        const ev = (await claimMealWindow(client, {
            handle: '+14155550123',
            scheduleId: 's1',
            venueId: 'hill-house',
            date: '2026-04-24',
            mealLabel: 'Dinner',
            startIso: '2026-04-24T22:30:00Z',
            endIso: '2026-04-25T01:30:00Z',
        }))!
        await markPreSent(client, ev.id)
        await markPostSent(client, ev.id)
        const reloaded = await findByMealKey(client, ev.mealKey)
        expect(reloaded?.preSentAt).toBeTruthy()
        expect(reloaded?.postSentAt).toBeTruthy()
    })

    it('records user reply text', async () => {
        const client = await setup()
        const ev = (await claimMealWindow(client, {
            handle: '+14155550123',
            scheduleId: 's1',
            venueId: 'hill-house',
            date: '2026-04-24',
            mealLabel: 'Dinner',
            startIso: '2026-04-24T22:30:00Z',
            endIso: '2026-04-25T01:30:00Z',
        }))!
        await recordUserReply(client, ev.id, 'pasta was fire')
        const reloaded = await findByMealKey(client, ev.mealKey)
        expect(reloaded?.userReply).toBe('pasta was fire')
    })

    it('finds pending post-meal events', async () => {
        const client = await setup()
        await claimMealWindow(client, {
            handle: '+14155550123',
            scheduleId: 's1',
            venueId: 'hill-house',
            date: '2026-04-24',
            mealLabel: 'Lunch',
            startIso: '2026-04-24T15:00:00Z',
            endIso: '2026-04-24T19:00:00Z',
        })
        const pending = await findPendingPostsBefore(client, '2026-04-24T19:30:00Z')
        expect(pending).toHaveLength(1)
        const tooEarly = await findPendingPostsBefore(client, '2026-04-24T19:00:00Z')
        expect(tooEarly).toHaveLength(0)
    })

    it('finds recent events for a handle', async () => {
        const client = await setup()
        await claimMealWindow(client, {
            handle: '+14155550123',
            scheduleId: 's1',
            venueId: 'hill-house',
            date: '2026-04-24',
            mealLabel: 'Lunch',
            startIso: new Date(Date.now() - 45 * 60_000).toISOString(),
            endIso: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        const recent = await findRecentForHandle(client, '+14155550123', 120)
        expect(recent).toHaveLength(1)
    })
})
