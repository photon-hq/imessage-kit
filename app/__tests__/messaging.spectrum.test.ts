import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { createSpectrumAdapter, verifySignature } from '../src/messaging/spectrum'

describe('spectrum adapter', () => {
    it('verifies a valid HMAC signature', () => {
        const secret = 'topsecret'
        const body = '{"event":"message.inbound"}'
        const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
        expect(verifySignature(secret, body, sig)).toBe(true)
    })

    it('rejects a bad signature', () => {
        expect(verifySignature('s', 'body', 'sha256=deadbeef')).toBe(false)
        expect(verifySignature('s', 'body', '')).toBe(false)
        expect(verifySignature('s', 'body', 'notasig')).toBe(false)
    })

    it('parses an inbound event body', () => {
        const secret = 's'
        const body = JSON.stringify({
            event: 'message.inbound',
            data: { from: '+14155550123', text: 'hi', ts: '2026-04-24T12:00:00Z', channel: 'imessage' },
        })
        const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
        const adapter = createSpectrumAdapter({
            apiKey: 'k',
            projectId: 'p',
            fromHandle: '+10000000000',
            webhookSecret: secret,
        })
        const msg = adapter.parseInbound(body, { 'x-spectrum-signature': sig })
        expect(msg?.from).toBe('+14155550123')
        expect(msg?.text).toBe('hi')
    })

    it('returns null when signature missing or wrong', () => {
        const adapter = createSpectrumAdapter({
            apiKey: 'k',
            projectId: 'p',
            fromHandle: '+10000000000',
            webhookSecret: 's',
        })
        const body = JSON.stringify({ event: 'message.inbound', data: { from: 'x', text: 'y' } })
        expect(adapter.parseInbound(body, {})).toBeNull()
        expect(adapter.parseInbound(body, { 'x-spectrum-signature': 'sha256=wrong' })).toBeNull()
    })

    it('ignores non-inbound events', () => {
        const secret = 's'
        const body = JSON.stringify({ event: 'message.sent', data: {} })
        const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
        const adapter = createSpectrumAdapter({
            apiKey: 'k',
            projectId: 'p',
            fromHandle: '+10000000000',
            webhookSecret: secret,
        })
        expect(adapter.parseInbound(body, { 'x-spectrum-signature': sig })).toBeNull()
    })
})
