export interface InboundMessage {
    from: string
    text: string
    receivedAt: string
}

export interface MessageAdapter {
    send(to: string, text: string): Promise<void>
    parseInbound(rawBody: string, headers: Record<string, string>): InboundMessage | null
}
