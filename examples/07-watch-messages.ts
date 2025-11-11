import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Watch for new messages
await sdk.startWatching({
    onDirectMessage: (msg) => {
        console.log(`DM from ${msg.sender}: ${msg.text}`)
    },
    onGroupMessage: (msg) => {
        console.log(`Group message: ${msg.text}`)
    }
})

// Keep running
process.on('SIGINT', async () => {
    await sdk.stopWatching()
    await sdk.close()
    process.exit(0)
})
