import type { MessageAdapter } from './types'

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
    }
}
