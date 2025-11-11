import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send text message
await sdk.send('pilot@photon.codes', 'Hello World')

await sdk.close()
