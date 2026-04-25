import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { routeInbound } from './agent/router'
import { createTidbitClient } from './agent/extractTidbits'
import { createGeminiAgentClient } from './agent/geminiClient'
import { loadEnv } from './config/env'
import { bootstrap } from './db/bootstrap'
import { createGoogleSheetsClient } from './db/sheets'
import { createSpectrumAdapter } from './messaging/spectrum'
import { runTick } from './scheduler/tick'
import { getVenueMenu } from './scraper'
import type { VenueMenu } from './scraper/types'

export const VERSION = '2.0.0'

async function main(): Promise<void> {
    const env = loadEnv()
    console.log(`[penneats] boot v${VERSION} port=${env.port} env=${env.nodeEnv}`)

    // Bind server immediately so /healthz passes before slow I/O (bootstrap + spectrum).
    const app = new Hono()
    app.get('/healthz', (c) => c.json({ ok: true }))
    const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
        console.log(`[penneats] listening on :${info.port}`)
    })

    const agentClient = createGeminiAgentClient(env.geminiApiKey)
    const tidbitClient = createTidbitClient(env.geminiApiKey)

    let tickInterval: ReturnType<typeof setInterval> | undefined
    let adapter: Awaited<ReturnType<typeof createSpectrumAdapter>> | undefined
    let tickRunning = false

    const startServices = async () => {
        const client = createGoogleSheetsClient(env.googleSheetId, env.googleServiceAccountJson)
        await bootstrap(client)
        console.log('[penneats] sheets bootstrapped')

        const fetchMenu = async (venueId: string, date: string): Promise<VenueMenu> =>
            getVenueMenu(venueId, date)

        console.log('[penneats] connecting to spectrum...')
        adapter = await createSpectrumAdapter({
            projectId: env.photonProjectId,
            projectSecret: env.photonProjectSecret,
        })
        console.log('[penneats] spectrum connected')

        // Start the tick AFTER the adapter is bound so we never enter runTick with a
        // missing adapter. The tickRunning guard prevents re-entry if a tick stretches
        // beyond the 60s interval (e.g. Sheets rate limiting).
        const boundAdapter = adapter
        tickInterval = setInterval(async () => {
            if (tickRunning) return
            tickRunning = true
            try {
                await runTick({ client, adapter: boundAdapter, now: new Date(), fetchMenu })
            } catch (err) {
                console.error('[penneats] tick error:', err instanceof Error ? err.message : err)
            } finally {
                tickRunning = false
            }
        }, 60_000)

        const consumeInbound = async (): Promise<void> => {
            for await (const [space, msg] of boundAdapter.instance.messages) {
                if (msg.content.type !== 'text') continue
                const handle = msg.sender.id
                const body = msg.content.text
                const tail = handle.slice(-4)
                try {
                    console.log(`[inbound] ...${tail} <- ${body.slice(0, 80)}`)
                    const reply = await routeInbound({
                        client,
                        rawHandle: handle,
                        text: body,
                        geminiClient: agentClient,
                        tidbitClient,
                        fetchMenu,
                    })
                    if (reply) {
                        console.log(`[inbound] ...${tail} -> ${reply.slice(0, 80)}`)
                        await space.send(reply)
                    }
                } catch (err) {
                    console.error('[penneats] inbound error:', err instanceof Error ? err.message : err)
                    try {
                        await space.send('Sorry, something went wrong — try again in a moment.')
                    } catch {
                        // already logged above
                    }
                }
            }
        }

        // The async iterator ending or throwing is treated as fatal: exit and let Fly's
        // restart policy reconnect with a fresh adapter rather than retrying a dead stream.
        consumeInbound().then(
            () => {
                console.error('[penneats] message stream ended; exiting for restart')
                process.exit(1)
            },
            (err) => {
                console.error(
                    '[penneats] message stream errored:',
                    err instanceof Error ? err.message : err,
                )
                process.exit(1)
            },
        )
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
