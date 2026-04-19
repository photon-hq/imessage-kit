import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send text message
await sdk.send({ to: 'pilot@photon.codes', text: 'Hello World' })

await sdk.close()
