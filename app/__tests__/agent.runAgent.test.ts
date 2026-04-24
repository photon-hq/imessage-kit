import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { addKnowledge } from '../src/db/knowledge'
import { createMemoryClient } from '../src/db/sheets'
import { executeTool } from '../src/agent/tools'
import { runAgent, type AgentGeminiClient } from '../src/agent/runAgent'

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    return client
}

describe('executeTool', () => {
    it('get_knowledge returns today rows', async () => {
        const client = await setup()
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: 'hill-house',
            mealLabel: 'Lunch',
            item: 'stir fry fire',
            tags: ['positive'],
        })
        const out = await executeTool('get_knowledge', { date: '2026-04-24' }, { client, user: null })
        expect(out).toContain('stir fry')
    })

    it('save_knowledge inserts a row', async () => {
        const client = await setup()
        await executeTool(
            'save_knowledge',
            { venueId: 'hill-house', mealLabel: 'Lunch', item: 'pizza solid', tags: ['positive'] },
            { client, user: null },
        )
        const out = await executeTool(
            'get_knowledge',
            { date: new Date().toISOString().slice(0, 10) },
            { client, user: null },
        )
        expect(out).toContain('pizza')
    })

    it('returns an error string for unknown tools', async () => {
        const client = await setup()
        const out = await executeTool('not_a_tool', {}, { client, user: null })
        expect(out.toLowerCase()).toContain('unknown')
    })
})

describe('runAgent', () => {
    it('stops when Gemini returns text-only', async () => {
        const client = await setup()
        const geminiClient: AgentGeminiClient = {
            async step() {
                return { text: 'Try Hill House today.', functionCalls: [] }
            },
        }
        const reply = await runAgent({
            client,
            user: null,
            text: 'what should I eat',
            geminiClient,
        })
        expect(reply).toBe('Try Hill House today.')
    })

    it('executes a tool call and feeds the result back', async () => {
        const client = await setup()
        await addKnowledge(client, {
            date: '2026-04-24',
            venueId: 'hill-house',
            mealLabel: 'Lunch',
            item: 'pasta fire',
            tags: ['positive'],
        })
        let step = 0
        const geminiClient: AgentGeminiClient = {
            async step(ctx) {
                step++
                if (step === 1) {
                    return {
                        text: '',
                        functionCalls: [{ name: 'get_knowledge', args: { date: '2026-04-24' } }],
                    }
                }
                const lastToolResult = ctx.history[ctx.history.length - 1]
                if (lastToolResult?.role === 'tool' && lastToolResult.content.includes('pasta')) {
                    return { text: 'Hill House — pasta is fire today.', functionCalls: [] }
                }
                return { text: 'fallback', functionCalls: [] }
            },
        }
        const reply = await runAgent({
            client,
            user: null,
            text: 'what should I eat',
            geminiClient,
        })
        expect(reply).toContain('pasta')
    })

    it('bails after MAX_ITERS with a fallback', async () => {
        const client = await setup()
        const geminiClient: AgentGeminiClient = {
            async step() {
                return { text: '', functionCalls: [{ name: 'get_knowledge', args: {} }] }
            },
        }
        const reply = await runAgent({
            client,
            user: null,
            text: 'infinite loop',
            geminiClient,
        })
        expect(reply.length).toBeGreaterThan(0)
    })
})
