import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { bootstrap } from '../src/db/bootstrap'
import { createMemoryClient } from '../src/db/sheets'
import { buildWebhookApp } from '../src/webhook'
import { createSpectrumAdapter } from '../src/messaging/spectrum'
import type { AgentGeminiClient } from '../src/agent/runAgent'
import type { TidbitGeminiClient } from '../src/agent/extractTidbits'

const agentStub: AgentGeminiClient = { async step() { return { text: 'ok', functionCalls: [] } } }
const tidbitStub: TidbitGeminiClient = { async extract() { return [] } }

describe('webhook app', () => {
    it('returns 200 and dispatches on a signed inbound', async () => {
        const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
        await bootstrap(client)
        const secret = 'wh-secret'
        const sent: Array<{ to: string; text: string }> = []
        const adapter = createSpectrumAdapter({
            apiKey: 'k', projectId: 'p', fromHandle: '+10000000000', webhookSecret: secret,
            fetchImpl: (async () => new Response('', { status: 200 })) as unknown as typeof fetch,
        })
        const origSend = adapter.send
        adapter.send = async (to, text) => { sent.push({ to, text }); await origSend(to, text) }

        const app: Hono = buildWebhookApp({
            client,
            adapter,
            geminiClient: agentStub,
            tidbitClient: tidbitStub,
        })

        const body = JSON.stringify({
            event: 'message.inbound',
            data: { from: '+14155550123', text: 'hi', ts: '2026-04-24T12:00:00Z', channel: 'imessage' },
        })
        const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

        const res = await app.request('/webhook', {
            method: 'POST',
            headers: { 'x-spectrum-signature': sig, 'content-type': 'application/json' },
            body,
        })
        expect(res.status).toBe(200)
        expect(sent).toHaveLength(1)
        expect(sent[0]?.to).toBe('+14155550123')
    })

    it('returns 200 but sends nothing on invalid signature', async () => {
        const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
        await bootstrap(client)
        const sent: Array<{ to: string; text: string }> = []
        const adapter = createSpectrumAdapter({
            apiKey: 'k', projectId: 'p', fromHandle: '+10000000000', webhookSecret: 'secret',
            fetchImpl: (async () => new Response('', { status: 200 })) as unknown as typeof fetch,
        })
        const origSend = adapter.send
        adapter.send = async (to, text) => { sent.push({ to, text }); await origSend(to, text) }

        const app = buildWebhookApp({ client, adapter, geminiClient: agentStub, tidbitClient: tidbitStub })
        const res = await app.request('/webhook', {
            method: 'POST',
            headers: { 'x-spectrum-signature': 'sha256=wrong', 'content-type': 'application/json' },
            body: JSON.stringify({ event: 'message.inbound', data: { from: '+14155550123', text: 'hi' } }),
        })
        expect(res.status).toBe(200)
        expect(sent).toHaveLength(0)
    })

    it('exposes a GET /healthz', async () => {
        const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
        await bootstrap(client)
        const adapter = createSpectrumAdapter({
            apiKey: 'k', projectId: 'p', fromHandle: '+10000000000', webhookSecret: 's',
        })
        const app = buildWebhookApp({ client, adapter, geminiClient: agentStub, tidbitClient: tidbitStub })
        const res = await app.request('/healthz')
        expect(res.status).toBe(200)
        const json = (await res.json()) as { ok: boolean }
        expect(json.ok).toBe(true)
    })
})
