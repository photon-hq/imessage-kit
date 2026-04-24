import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { addKnowledge, getKnowledgeForDay } from '../src/db/knowledge'
import { createMemoryClient } from '../src/db/sheets'

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    return client
}

describe('knowledge repo', () => {
    it('adds and lists knowledge for a day', async () => {
        const client = await setup()
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: 'hill-house',
            mealLabel: 'Dinner',
            item: 'stir fry was fire',
            tags: ['positive', 'asian'],
        })
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: '1920-commons',
            mealLabel: 'Lunch',
            item: 'salad bar was picked over',
            tags: ['negative'],
        })
        const today = await getKnowledgeForDay(client, '2026-04-24')
        expect(today).toHaveLength(2)
    })

    it('filters by venue', async () => {
        const client = await setup()
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: 'hill-house',
            mealLabel: 'Dinner',
            item: 'stir fry was fire',
            tags: ['positive'],
        })
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: '1920-commons',
            mealLabel: 'Lunch',
            item: 'pizza ok',
            tags: ['neutral'],
        })
        const hill = await getKnowledgeForDay(client, '2026-04-24', 'hill-house')
        expect(hill).toHaveLength(1)
        expect(hill[0]?.item).toContain('stir fry')
    })

    it('ignores prior days', async () => {
        const client = await setup()
        await addKnowledge(client, {
            date: '2026-04-23',
            venueId: 'hill-house',
            mealLabel: 'Dinner',
            item: 'old note',
            tags: [],
        })
        const today = await getKnowledgeForDay(client, '2026-04-24')
        expect(today).toHaveLength(0)
    })
})
