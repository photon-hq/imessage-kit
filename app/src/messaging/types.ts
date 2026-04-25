export interface MessageAdapter {
    send(to: string, text: string): Promise<void>
}
