import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

await sdk.startWatching({
    onDirectMessage: async (msg) => {
        await sdk.message(msg)
            .ifFromOthers()
            .matchText(/hello/i)
            .replyText('Hi there!')
            .execute()
    }
})

process.on('SIGINT', async () => {
    await sdk.stopWatching()
    await sdk.close()
    process.exit(0)
})
