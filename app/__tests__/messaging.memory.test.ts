import { describe, expect, it } from 'bun:test'
import { createMemoryAdapter } from '../src/messaging/memory'

describe('memory message adapter', () => {
    it('records sent messages', async () => {
        const adapter = createMemoryAdapter()
        await adapter.send('+14155550123', 'hello')
        await adapter.send('+14155550123', 'again')
        expect(adapter.sent).toHaveLength(2)
        expect(adapter.sent[0]).toEqual({ to: '+14155550123', text: 'hello' })
    })

    it('parses a synthetic inbound body', () => {
        const adapter = createMemoryAdapter()
        const body = JSON.stringify({ from: '+14155550123', text: 'hi', ts: '2026-04-24T12:00:00Z' })
        const msg = adapter.parseInbound(body, {})
        expect(msg?.from).toBe('+14155550123')
        expect(msg?.text).toBe('hi')
    })
})
