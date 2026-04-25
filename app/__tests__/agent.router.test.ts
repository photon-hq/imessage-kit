import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { claimMealWindow, findByMealKey, markPostSent } from '../src/db/mealEvents'
import { createMemoryClient } from '../src/db/sheets'
import { createUser, getUser, updateUser } from '../src/db/users'
import { routeInbound } from '../src/agent/router'
import type { AgentGeminiClient } from '../src/agent/runAgent'
import type { TidbitGeminiClient } from '../src/agent/extractTidbits'

const geminiStub: AgentGeminiClient = {
    async step() {
        return { text: 'free text reply', functionCalls: [] }
    },
}

const tidbitStub: TidbitGeminiClient = {
    async extract() {
        return []
    },
}

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    return client
}

describe('routeInbound', () => {
    it('creates user + kicks off onboarding on first contact', async () => {
        const client = await setup()
        const reply = await routeInbound({
            client,
            rawHandle: '+1 (415) 555-0123',
            text: 'hi',
            geminiClient: geminiStub,
            tidbitClient: tidbitStub,
        })
        expect(reply.length).toBeGreaterThan(0)
        const u = await getUser(client, '+14155550123')
        expect(u?.state).toBe('onboarding')
    })

    it('continues onboarding if not done', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        await updateUser(client, '+14155550123', {
            state: 'onboarding',
            onboardingStep: 'ask_name',
        })
        const reply = await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'Alice',
            geminiClient: geminiStub,
            tidbitClient: tidbitStub,
        })
        expect(reply.length).toBeGreaterThan(0)
        const u = await getUser(client, '+14155550123')
        expect(u?.name).toBe('Alice')
        expect(u?.onboardingStep).toBe('ask_email')
    })

    it('routes active user free text to runAgent', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        await updateUser(client, '+14155550123', { state: 'active', onboardingStep: 'done' })
        const reply = await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'whats good for lunch',
            geminiClient: geminiStub,
            tidbitClient: tidbitStub,
        })
        expect(reply).toBe('free text reply')
    })

    it('passes prior conversation turns into runAgent and persists new ones', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        await updateUser(client, '+14155550123', { state: 'active', onboardingStep: 'done' })

        const captured: { value: { historyLen: number; firstText: string } | null } = { value: null }
        const recordingClient: AgentGeminiClient = {
            async step(ctx) {
                captured.value = {
                    historyLen: ctx.history.length,
                    firstText: ctx.history[0]?.content ?? '',
                }
                return { text: 'pong', functionCalls: [] }
            },
        }

        await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'first ping',
            geminiClient: recordingClient,
            tidbitClient: tidbitStub,
        })
        expect(captured.value?.historyLen).toBe(1)

        await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'second ping',
            geminiClient: recordingClient,
            tidbitClient: tidbitStub,
        })
        expect(captured.value?.historyLen).toBe(3)
        expect(captured.value?.firstText).toBe('first ping')
    })

    it('handles /clear by wiping conversation history for that handle', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        await updateUser(client, '+14155550123', { state: 'active', onboardingStep: 'done' })

        const captured: { value: number } = { value: -1 }
        const recordingClient: AgentGeminiClient = {
            async step(ctx) {
                captured.value = ctx.history.length
                return { text: 'pong', functionCalls: [] }
            },
        }

        await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'first',
            geminiClient: recordingClient,
            tidbitClient: tidbitStub,
        })
        await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'second',
            geminiClient: recordingClient,
            tidbitClient: tidbitStub,
        })
        expect(captured.value).toBe(3)

        const clearReply = await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: '/clear',
            geminiClient: recordingClient,
            tidbitClient: tidbitStub,
        })
        expect(clearReply.toLowerCase()).toContain('cleared')

        await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'after clear',
            geminiClient: recordingClient,
            tidbitClient: tidbitStub,
        })
        expect(captured.value).toBe(1)
    })

    it('routes a reply to a recently post-sent meal as a followup', async () => {
        const client = await setup()
        await createUser(client, { handle: '+14155550123' })
        await updateUser(client, '+14155550123', { state: 'active', onboardingStep: 'done' })
        const ev = (await claimMealWindow(client, {
            handle: '+14155550123',
            scheduleId: 's1',
            venueId: 'hill-house',
            date: new Date().toISOString().slice(0, 10),
            mealLabel: 'Lunch',
            startIso: new Date(Date.now() - 60 * 60_000).toISOString(),
            endIso: new Date(Date.now() - 20 * 60_000).toISOString(),
        }))!
        await markPostSent(client, ev.id)

        await routeInbound({
            client,
            rawHandle: '+14155550123',
            text: 'pasta was fire',
            geminiClient: geminiStub,
            tidbitClient: {
                async extract() {
                    return [{ item: 'pasta was fire', tags: ['positive', 'pasta'] }]
                },
            },
        })

        const reloaded = await findByMealKey(client, ev.mealKey)
        expect(reloaded?.userReply).toContain('pasta')
    })
})
