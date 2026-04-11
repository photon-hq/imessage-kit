import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Watcher must be running to confirm delivery
await sdk.startWatching()

const result = await sdk.send('pilot@photon.codes', 'Test message')

if (result.message) {
    console.log('Confirmed:', result.message.text)
    console.log('ID:', result.message.id)
} else {
    console.log('Sent but not yet confirmed in database')
}

sdk.stopWatching()
await sdk.close()
