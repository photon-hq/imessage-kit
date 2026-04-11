import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

await sdk.startWatching({
    onDirectMessage: (msg) => {
        console.log(`DM from ${msg.participant}: ${msg.text}`)
    },
    onGroupMessage: (msg) => {
        console.log(`Group message: ${msg.text}`)
    },
})

process.on('SIGINT', async () => {
    sdk.stopWatching()
    await sdk.close()
    process.exit(0)
})
