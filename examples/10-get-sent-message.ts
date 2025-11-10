import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Must start watcher to get sent message
await sdk.startWatching()

// Send and immediately get the sent message
const result = await sdk.send('pilot@photon.codes', 'Test message')

if (result.message) {
    console.log('Sent message:', result.message.text)
    console.log('Message ID:', result.message.id)
} else {
    console.log('Message sent but not confirmed yet')
}

await sdk.stopWatching()
await sdk.close()
