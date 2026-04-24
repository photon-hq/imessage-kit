import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { getKnowledgeForDay } from '../src/db/knowledge'
import { claimMealWindow, findByMealKey } from '../src/db/mealEvents'
import { createMemoryClient } from '../src/db/sheets'
import { createUser } from '../src/db/users'
import { buildFollowupMessage, ingestFollowupReply } from '../src/agent/flows/followup'

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    await createUser(client, { handle: '+14155550123' })
    const event = (await claimMealWindow(client, {
        handle: '+14155550123',
        scheduleId: 's1',
        venueId: 'hill-house',
        date: '2026-04-24',
        mealLabel: 'Dinner',
        startIso: '2026-04-24T22:30:00Z',
        endIso: '2026-04-25T01:30:00Z',
    }))!
    return { client, event }
}

describe('followup flow', () => {
    it('buildFollowupMessage references the venue', async () => {
        const { event } = await setup()
        const msg = buildFollowupMessage({
            handle: event.handle,
            venueName: 'Hill House',
        })
        expect(msg.toLowerCase()).toContain('hill house')
    })

    it('saves user reply on the event', async () => {
        const { client, event } = await setup()
        await ingestFollowupReply({
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
            event,
            reply: 'pasta was fire, salad bar picked over',
            extractTidbits: async () => [],
        })
        const reloaded = await findByMealKey(client, event.mealKey)
        expect(reloaded?.userReply).toContain('pasta')
    })

    it('writes extracted tidbits to knowledge', async () => {
        const { client, event } = await setup()
        await ingestFollowupReply({
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
            event,
            reply: 'pasta was fire',
            extractTidbits: async () => [{ item: 'pasta was fire', tags: ['positive', 'pasta'] }],
        })
        const rows = await getKnowledgeForDay(client, '2026-04-24', 'hill-house')
        expect(rows).toHaveLength(1)
        expect(rows[0]?.item).toBe('pasta was fire')
    })
})
