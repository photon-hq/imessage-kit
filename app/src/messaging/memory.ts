import type { InboundMessage, MessageAdapter } from './types'

export interface MemoryAdapter extends MessageAdapter {
    sent: Array<{ to: string; text: string }>
}

export function createMemoryAdapter(): MemoryAdapter {
    const sent: Array<{ to: string; text: string }> = []
    return {
        sent,
        async send(to, text) {
            sent.push({ to, text })
        },
        parseInbound(rawBody): InboundMessage | null {
            try {
                const obj = JSON.parse(rawBody) as { from?: string; text?: string; ts?: string }
                if (!obj.from || !obj.text) return null
                return {
                    from: obj.from,
                    text: obj.text,
                    receivedAt: obj.ts ?? new Date().toISOString(),
                }
            } catch {
                return null
            }
        },
    }
}
