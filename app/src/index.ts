import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { GoogleGenAI, Type, type FunctionDeclaration, type Part } from '@google/genai'
import { routeInbound } from './agent/router'
import { createTidbitClient } from './agent/extractTidbits'
import type { AgentFunctionCall, AgentGeminiClient, AgentStepContext } from './agent/runAgent'
import { loadEnv } from './config/env'
import { bootstrap } from './db/bootstrap'
import { createGoogleSheetsClient } from './db/sheets'
import { createSpectrumAdapter } from './messaging/spectrum'
import { runTick } from './scheduler/tick'
import { createGeminiClient, getVenueMenu } from './scraper'
import type { VenueMenu } from './scraper/types'

export const VERSION = '2.0.0'

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
    {
        name: 'get_knowledge',
        description: 'Read anonymized food insights other Penn students left today or on a specific date. Optionally filter by venueId.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                date: { type: Type.STRING, description: 'YYYY-MM-DD; omit for today' },
                venueId: { type: Type.STRING, description: 'venue id like "hill-house" (optional)' },
            },
        },
    },
    {
        name: 'save_knowledge',
        description: 'Save an anonymized tidbit. Use only when the user mentions something publicly useful.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                venueId: { type: Type.STRING },
                mealLabel: { type: Type.STRING },
                item: { type: Type.STRING, description: 'Short paraphrase, under 60 chars' },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['venueId', 'mealLabel', 'item', 'tags'],
        },
    },
    {
        name: 'get_venue_menu',
        description: "Fetch today's food items for a specific venue + meal.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                venueId: { type: Type.STRING },
                date: { type: Type.STRING },
                mealLabel: { type: Type.STRING },
            },
            required: ['venueId'],
        },
    },
]

function createGeminiAgentClient(apiKey: string, model = 'gemini-2.5-flash'): AgentGeminiClient {
    const ai = new GoogleGenAI({ apiKey })
    return {
        async step(ctx: AgentStepContext) {
            const contents = ctx.history.map((turn) => {
                if (turn.role === 'tool') {
                    return {
                        role: 'user',
                        parts: [
                            {
                                functionResponse: {
                                    name: turn.toolName ?? 'tool',
                                    response: { result: turn.content },
                                },
                            } as Part,
                        ],
                    }
                }
                if (turn.role === 'model') {
                    const parts: Part[] = []
                    if (turn.content) parts.push({ text: turn.content } as Part)
                    for (const fc of turn.functionCalls ?? []) {
                        parts.push({ functionCall: { name: fc.name, args: fc.args } } as Part)
                    }
                    if (parts.length === 0) parts.push({ text: '' } as Part)
                    return { role: 'model', parts }
                }
                return { role: 'user', parts: [{ text: turn.content } as Part] }
            })

            const response = await ai.models.generateContent({
                model,
                contents,
                config: {
                    systemInstruction: ctx.systemPrompt,
                    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
                    maxOutputTokens: 1024,
                },
            })
            const parts: Part[] = response.candidates?.[0]?.content?.parts ?? []
            const calls: AgentFunctionCall[] = []
            let textOut = ''
            for (const p of parts) {
                if (p.functionCall) {
                    calls.push({
                        name: p.functionCall.name ?? '',
                        args: (p.functionCall.args ?? {}) as AgentFunctionCall['args'],
                    })
                } else if (p.text) {
                    textOut += p.text
                }
            }
            return { text: textOut, functionCalls: calls }
        },
    }
}

async function main(): Promise<void> {
    const env = loadEnv()
    console.log(`[penneats] boot v${VERSION} port=${env.port} env=${env.nodeEnv}`)

    // Bind server immediately so /healthz passes before slow I/O (bootstrap + spectrum)
    const app = new Hono()
    app.get('/healthz', (c) => c.json({ ok: true }))
    const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
        console.log(`[penneats] listening on :${info.port}`)
    })

    const menuClient = createGeminiClient(env.geminiApiKey)
    const agentClient = createGeminiAgentClient(env.geminiApiKey)
    const tidbitClient = createTidbitClient(env.geminiApiKey)

    let tickInterval: ReturnType<typeof setInterval> | undefined
    let adapter: Awaited<ReturnType<typeof createSpectrumAdapter>> | undefined

    const startServices = async () => {
        const client = createGoogleSheetsClient(env.googleSheetId, env.googleServiceAccountJson)
        await bootstrap(client)
        console.log('[penneats] sheets bootstrapped')

        const fetchMenu = async (venueId: string, date: string): Promise<VenueMenu> =>
            getVenueMenu(venueId, date, { client: menuClient })

        tickInterval = setInterval(async () => {
            if (!adapter) return
            try {
                await runTick({ client, adapter, now: new Date(), fetchMenu })
            } catch (err) {
                console.error('[penneats] tick error:', err instanceof Error ? err.message : err)
            }
        }, 60_000)

        console.log('[penneats] connecting to spectrum...')
        adapter = await createSpectrumAdapter({
            projectId: env.spectrumProjectId,
            projectSecret: env.spectrumApiKey,
        })
        console.log('[penneats] spectrum connected')

        const consumeInbound = async (): Promise<void> => {
            for await (const [space, msg] of adapter!.instance.messages) {
                if (msg.content.type !== 'text') continue
                const handle = msg.sender.id
                const body = msg.content.text
                try {
                    const reply = await routeInbound({
                        client,
                        rawHandle: handle,
                        text: body,
                        geminiClient: agentClient,
                        tidbitClient,
                        fetchMenu,
                    })
                    if (reply) await space.send(reply)
                } catch (err) {
                    console.error('[penneats] inbound error:', err instanceof Error ? err.message : err)
                    try {
                        await space.send('Sorry, something went wrong — try again in a moment.')
                    } catch {
                        // already logged
                    }
                }
            }
        }
        void consumeInbound().catch((err) => {
            console.error('[penneats] message stream ended:', err instanceof Error ? err.message : err)
            process.exit(1)
        })
    }

    void startServices().catch((err) => {
        console.error('[penneats] startup error:', err instanceof Error ? err.message : err)
    })

    const shutdown = async (signal: string) => {
        console.log(`[penneats] ${signal} received, shutting down`)
        if (tickInterval) clearInterval(tickInterval)
        await adapter?.stop().catch(() => {})
        server.close()
        process.exit(0)
    }
    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
}

if (import.meta.main) {
    main().catch((err) => {
        console.error('[penneats] fatal:', err)
        process.exit(1)
    })
}
