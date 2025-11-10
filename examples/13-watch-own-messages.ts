import { IMessageSDK } from '../src'

const sdk = new IMessageSDK({
    watcher: {
        excludeOwnMessages: false  // Include own messages
    }
})

// Watch all messages including own messages
await sdk.startWatching({
    onMessage: (msg) => {
        const prefix = msg.isFromMe ? '[ME]' : '[OTHER]'
        console.log(`${prefix} ${msg.sender}: ${msg.text}`)
    }
})

console.log('Watching all messages (including own)...')
console.log('Press Ctrl+C to stop')

process.on('SIGINT', async () => {
    await sdk.stopWatching()
    await sdk.close()
    process.exit(0)
})
