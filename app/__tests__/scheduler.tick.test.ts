import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { findByMealKey, findPendingPostsBefore } from '../src/db/mealEvents'
import { addSchedule } from '../src/db/schedules'
import { createMemoryClient } from '../src/db/sheets'
import { createUser, updateUser } from '../src/db/users'
import { createMemoryAdapter } from '../src/messaging/memory'
import { runTick } from '../src/scheduler/tick'
import type { VenueMenu } from '../src/scraper/types'

function emptyMenu(id: string): VenueMenu {
    return {
        venueId: id,
        venueName: id,
        date: '2026-04-24',
        fetchedAt: '2026-04-24T12:00:00Z',
        dayparts: [
            {
                label: 'Lunch',
                startIso: '2026-04-24T16:00:00Z',
                endIso: '2026-04-24T19:00:00Z',
                stations: [{ name: 'Main', items: [{ name: 'Food', tags: [] }] }],
            },
        ],
    }
}

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    await createUser(client, { handle: '+14155550123' })
    await updateUser(client, '+14155550123', { state: 'active', onboardingStep: 'done' })
    return client
}

describe('runTick', () => {
    it('claims + sends pre-meal when schedule fires in ~20 min', async () => {
        const client = await setup()
        const now = new Date('2026-04-24T15:40:00Z')
        await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'hill-house',
            dayOfWeek: 5,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        const adapter = createMemoryAdapter()
        await runTick({
            client,
            adapter,
            now,
            fetchMenu: async (id) => emptyMenu(id),
        })
        expect(adapter.sent).toHaveLength(1)
        expect(adapter.sent[0]?.to).toBe('+14155550123')
        expect(adapter.sent[0]?.text.toLowerCase()).toContain('lunch')
    })

    it('does not double-send if tick runs twice in the same window', async () => {
        const client = await setup()
        const now = new Date('2026-04-24T15:40:00Z')
        await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'hill-house',
            dayOfWeek: 5,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        const adapter = createMemoryAdapter()
        await runTick({ client, adapter, now, fetchMenu: async (id) => emptyMenu(id) })
        await runTick({ client, adapter, now, fetchMenu: async (id) => emptyMenu(id) })
        expect(adapter.sent).toHaveLength(1)
    })

    it('does not fire pre-meal outside the 18-22 min window', async () => {
        const client = await setup()
        const tooEarly = new Date('2026-04-24T15:30:00Z')
        const tooLate = new Date('2026-04-24T15:50:00Z')
        await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'hill-house',
            dayOfWeek: 5,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        const adapter = createMemoryAdapter()
        await runTick({ client, adapter, now: tooEarly, fetchMenu: async (id) => emptyMenu(id) })
        await runTick({ client, adapter, now: tooLate, fetchMenu: async (id) => emptyMenu(id) })
        expect(adapter.sent).toHaveLength(0)
    })

    it('sends post-meal followup 10 minutes after meal end', async () => {
        const client = await setup()
        const now = new Date('2026-04-24T15:40:00Z')
        await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'hill-house',
            dayOfWeek: 5,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        const adapter = createMemoryAdapter()
        await runTick({ client, adapter, now, fetchMenu: async (id) => emptyMenu(id) })
        expect(adapter.sent).toHaveLength(1)

        const later = new Date('2026-04-24T17:45:00Z')
        await runTick({ client, adapter, now: later, fetchMenu: async (id) => emptyMenu(id) })
        expect(adapter.sent).toHaveLength(2)
        expect(adapter.sent[1]?.text.toLowerCase()).toMatch(/how/i)

        const pending = await findPendingPostsBefore(client, '2026-04-24T19:00:00Z')
        expect(pending).toHaveLength(0)
    })

    it('skips inactive users', async () => {
        const client = await setup()
        await updateUser(client, '+14155550123', { state: 'onboarding' })
        const now = new Date('2026-04-24T15:40:00Z')
        await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'hill-house',
            dayOfWeek: 5,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        const adapter = createMemoryAdapter()
        await runTick({ client, adapter, now, fetchMenu: async (id) => emptyMenu(id) })
        expect(adapter.sent).toHaveLength(0)
    })

    it('continues processing other users when one fails', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155559999' })
        await updateUser(client, '+14155559999', { state: 'active', onboardingStep: 'done' })
        const now = new Date('2026-04-24T15:40:00Z')
        await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'hill-house',
            dayOfWeek: 5,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        await addSchedule(client, {
            handle: '+14155559999',
            venueId: 'hill-house',
            dayOfWeek: 5,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        const adapter = createMemoryAdapter()
        const origSend = adapter.send
        adapter.send = async (to, text) => {
            if (to === '+14155550123') throw new Error('boom')
            await origSend(to, text)
        }
        await runTick({ client, adapter, now, fetchMenu: async (id) => emptyMenu(id) })
        expect(adapter.sent).toHaveLength(1)
        expect(adapter.sent[0]?.to).toBe('+14155559999')
        const ev = await findByMealKey(client, (await (async () => {
            const { computeMealKey } = await import('../src/db/mealEvents')
            return computeMealKey('+14155550123', '2026-04-24', 'Lunch')
        })()))
        expect(ev?.preSentAt).toBe('')
    })
})
