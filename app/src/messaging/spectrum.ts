import { createHmac, timingSafeEqual } from 'node:crypto'
import type { InboundMessage, MessageAdapter } from './types'

export interface SpectrumConfig {
    apiKey: string
    projectId: string
    fromHandle: string
    webhookSecret: string
    baseUrl?: string
    fetchImpl?: typeof fetch
}

export function verifySignature(
    secret: string,
    rawBody: string,
    header: string | undefined,
): boolean {
    if (!header) return false
    const prefix = 'sha256='
    if (!header.startsWith(prefix)) return false
    const expected = header.slice(prefix.length)
    const computed = createHmac('sha256', secret).update(rawBody).digest('hex')
    let a: Buffer
    let b: Buffer
    try {
        a = Buffer.from(expected, 'hex')
        b = Buffer.from(computed, 'hex')
    } catch {
        return false
    }
    if (a.length === 0 || a.length !== b.length) return false
    return timingSafeEqual(a, b)
}

export function createSpectrumAdapter(cfg: SpectrumConfig): MessageAdapter {
    const baseUrl = cfg.baseUrl ?? 'https://spectrum.photon.codes'
    const fetchImpl = cfg.fetchImpl ?? fetch

    return {
        async send(to, text) {
            const basic = Buffer.from(`${cfg.projectId}:${cfg.apiKey}`).toString('base64')
            const res = await fetchImpl(`${baseUrl}/projects/${cfg.projectId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${basic}`,
                },
                body: JSON.stringify({
                    channel: 'imessage',
                    from: cfg.fromHandle || undefined,
                    to,
                    text,
                }),
            })
            if (!res.ok) {
                throw new Error(`Photon send failed: ${res.status} ${await res.text()}`)
            }
        },
        parseInbound(rawBody, headers): InboundMessage | null {
            const sigHeader =
                headers['x-spectrum-signature'] ?? headers['X-Spectrum-Signature']
            if (!verifySignature(cfg.webhookSecret, rawBody, sigHeader)) return null
            let obj: unknown
            try {
                obj = JSON.parse(rawBody)
            } catch {
                return null
            }
            if (typeof obj !== 'object' || obj === null) return null
            const evt = obj as {
                event?: string
                data?: { from?: string; text?: string; ts?: string }
            }
            if (evt.event !== 'message.inbound') return null
            const d = evt.data
            if (!d?.from || !d?.text) return null
            return { from: d.from, text: d.text, receivedAt: d.ts ?? new Date().toISOString() }
        },
    }
}
