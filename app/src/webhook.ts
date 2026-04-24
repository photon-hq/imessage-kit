import { Hono } from 'hono'
import { routeInbound } from './agent/router'
import type { AgentGeminiClient } from './agent/runAgent'
import type { TidbitGeminiClient } from './agent/extractTidbits'
import type { SheetsClient } from './db/sheets'
import type { MessageAdapter } from './messaging/types'

export interface WebhookDeps {
    client: SheetsClient
    adapter: MessageAdapter
    geminiClient: AgentGeminiClient
    tidbitClient: TidbitGeminiClient
}

export function buildWebhookApp(deps: WebhookDeps): Hono {
    const app = new Hono()

    app.get('/healthz', (c) => c.json({ ok: true }))

    app.post('/webhook', async (c) => {
        const rawBody = await c.req.text()
        const headers: Record<string, string> = {}
        c.req.raw.headers.forEach((v, k) => {
            headers[k.toLowerCase()] = v
        })

        const msg = deps.adapter.parseInbound(rawBody, headers)
        if (!msg) return c.json({ ok: true, ignored: true })

        try {
            const reply = await routeInbound({
                client: deps.client,
                rawHandle: msg.from,
                text: msg.text,
                geminiClient: deps.geminiClient,
                tidbitClient: deps.tidbitClient,
            })
            if (reply) await deps.adapter.send(msg.from, reply)
        } catch (err) {
            console.error('[webhook] route error:', err instanceof Error ? err.message : err)
            try {
                await deps.adapter.send(msg.from, 'Sorry, something went wrong — try again in a moment.')
            } catch {
                // swallow; we already logged
            }
        }

        return c.json({ ok: true })
    })

    return app
}
