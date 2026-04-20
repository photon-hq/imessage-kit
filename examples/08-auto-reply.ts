import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

await sdk.startWatching({
    onDirectMessage: async (msg) => {
        if (!msg.text || !/hello/i.test(msg.text)) return
        if (!msg.chatId) return // rare WAL race: chat_message_join not yet flushed
        await sdk.send({ to: msg.chatId, text: 'Hi there!' })
    },
})

process.on('SIGINT', async () => {
    await sdk.close()
    process.exit(0)
})
