import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// onMessage receives ALL messages including your own
await sdk.startWatching({
    onMessage: (msg) => {
        const prefix = msg.isFromMe ? '[ME]' : '[OTHER]'
        console.log(`${prefix} ${msg.participant ?? 'unknown'}: ${msg.text}`)
    },
})

process.on('SIGINT', async () => {
    sdk.stopWatching()
    await sdk.close()
    process.exit(0)
})
