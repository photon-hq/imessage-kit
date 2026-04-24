import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { addKnowledge } from '../src/db/knowledge'
import { createMemoryClient } from '../src/db/sheets'
import { createUser } from '../src/db/users'
import { buildRecommendation } from '../src/agent/flows/recommend'
import type { VenueMenu } from '../src/scraper/types'

function menu(venueId: string, itemName: string, tags: string[]): VenueMenu {
    return {
        venueId,
        venueName: venueId,
        date: '2026-04-24',
        fetchedAt: '2026-04-24T12:00:00Z',
        dayparts: [
            {
                label: 'Lunch',
                startIso: '2026-04-24T16:00:00Z',
                endIso: '2026-04-24T19:00:00Z',
                stations: [{ name: 'Main', items: [{ name: itemName, tags }] }],
            },
        ],
    }
}

async function setup(handle: string) {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    await createUser(client, { handle })
    return client
}

describe('buildRecommendation', () => {
    it('picks a single specific venue when schedule names one', async () => {
        const client = await setup('+14155550123')
        const rec = await buildRecommendation({
            client,
            user: {
                handle: '+14155550123',
                name: 'Alice',
                email: '',
                dietaryRestrictions: [],
                state: 'active',
                stateContext: {},
                onboardingStep: 'done',
                createdAt: '',
                updatedAt: '',
            },
            venueId: 'hill-house',
            mealLabel: 'Lunch',
            date: '2026-04-24',
            fetchMenu: async (id) => menu(id, 'Stir Fry', []),
        })
        expect(rec.venueId).toBe('hill-house')
        expect(rec.message).toMatch(/hill.house/i)
    })

    it('chooses best-ranked venue when schedule is auto', async () => {
        const client = await setup('+14155550123')
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: 'hill-house',
            mealLabel: 'Lunch',
            item: 'stir fry fire',
            tags: ['positive'],
        })
        const rec = await buildRecommendation({
            client,
            user: {
                handle: '+14155550123',
                name: 'Alice',
                email: '',
                dietaryRestrictions: [],
                state: 'active',
                stateContext: {},
                onboardingStep: 'done',
                createdAt: '',
                updatedAt: '',
            },
            venueId: 'auto',
            mealLabel: 'Lunch',
            date: '2026-04-24',
            fetchMenu: async (id) => menu(id, 'Stir Fry', []),
        })
        expect(rec.venueId).toBe('hill-house')
        expect(rec.message).toMatch(/stir fry/i)
    })

    it('surfaces knowledge in the message', async () => {
        const client = await setup('+14155550123')
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: 'hill-house',
            mealLabel: 'Lunch',
            item: 'pasta was fire',
            tags: ['positive'],
        })
        const rec = await buildRecommendation({
            client,
            user: {
                handle: '+14155550123',
                name: 'Alice',
                email: '',
                dietaryRestrictions: [],
                state: 'active',
                stateContext: {},
                onboardingStep: 'done',
                createdAt: '',
                updatedAt: '',
            },
            venueId: 'hill-house',
            mealLabel: 'Lunch',
            date: '2026-04-24',
            fetchMenu: async (id) => menu(id, 'Stir Fry', []),
        })
        expect(rec.message.toLowerCase()).toContain('pasta')
    })
})
