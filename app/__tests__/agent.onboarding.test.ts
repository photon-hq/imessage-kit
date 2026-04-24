import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { listSchedules } from '../src/db/schedules'
import { createMemoryClient } from '../src/db/sheets'
import { createUser, getUser } from '../src/db/users'
import { handleOnboardingStep } from '../src/agent/flows/onboarding'

async function setup(handle: string) {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    await createUser(client, { handle })
    return client
}

const HANDLE = '+14155550123'

describe('onboarding', () => {
    it('asks for name first', async () => {
        const client = await setup(HANDLE)
        const user = (await getUser(client, HANDLE))!
        const { reply } = await handleOnboardingStep({ client }, user, 'hi')
        expect(reply.length).toBeGreaterThan(0)
        expect((await getUser(client, HANDLE))?.onboardingStep).toBe('ask_name')
    })

    it('captures name and advances to email', async () => {
        const client = await setup(HANDLE)
        const u0 = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u0, 'hi')
        const u1 = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u1, 'Alice')
        const u2 = (await getUser(client, HANDLE))!
        expect(u2.name).toBe('Alice')
        expect(u2.onboardingStep).toBe('ask_email')
    })

    it('rejects bad email and stays on step', async () => {
        const client = await setup(HANDLE)
        const u0 = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u0, 'hi')
        const u1 = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u1, 'Alice')
        const u2 = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u2, 'notanemail')
        const u3 = (await getUser(client, HANDLE))!
        expect(u3.email).toBe('')
        expect(u3.onboardingStep).toBe('ask_email')
    })

    it('advances through days → diet → done and creates schedules', async () => {
        const client = await setup(HANDLE)
        let u = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u, 'hi')
        u = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u, 'Alice')
        u = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u, 'alice@upenn.edu')
        u = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u, '1920, Hill House')
        u = (await getUser(client, HANDLE))!
        await handleOnboardingStep({ client }, u, 'weekdays lunch 12:00 and dinner 18:30')
        u = (await getUser(client, HANDLE))!
        const { reply } = await handleOnboardingStep({ client }, u, 'vegan')
        u = (await getUser(client, HANDLE))!

        expect(u.state).toBe('active')
        expect(u.onboardingStep).toBe('done')
        expect(u.dietaryRestrictions).toEqual(['vegan'])
        expect(reply.length).toBeGreaterThan(0)

        const scheds = await listSchedules(client, HANDLE)
        // 5 weekdays × 2 meals = 10 schedules
        expect(scheds.length).toBe(10)
    })
})
