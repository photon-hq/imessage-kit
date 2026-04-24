import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { createMemoryClient } from '../src/db/sheets'
import { createUser, getUser, updateUser } from '../src/db/users'

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    return client
}

describe('users repo', () => {
    it('returns null for unknown handle', async () => {
        const client = await setup()
        expect(await getUser(client, '+14155550123')).toBeNull()
    })

    it('creates and reads a user', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        const u = await getUser(client, '+14155550123')
        expect(u?.handle).toBe('+14155550123')
        expect(u?.state).toBe('new')
        expect(u?.onboardingStep).toBe('ask_name')
        expect(u?.dietaryRestrictions).toEqual([])
        expect(u?.stateContext).toEqual({})
        expect(u?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('updates individual fields', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        await updateUser(client, '+14155550123', { name: 'Alice', onboardingStep: 'ask_email' })
        const u = await getUser(client, '+14155550123')
        expect(u?.name).toBe('Alice')
        expect(u?.onboardingStep).toBe('ask_email')
    })

    it('serializes dietary restrictions and state context as JSON', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        await updateUser(client, '+14155550123', {
            dietaryRestrictions: ['vegan', 'gluten-free'],
            stateContext: { lastVenueId: 'hill-house' },
            state: 'active',
        })
        const u = await getUser(client, '+14155550123')
        expect(u?.dietaryRestrictions).toEqual(['vegan', 'gluten-free'])
        expect(u?.stateContext).toEqual({ lastVenueId: 'hill-house' })
        expect(u?.state).toBe('active')
    })
})
