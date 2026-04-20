import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send text message
await sdk.send({ to: 'recipient@example.com', text: 'Hello World' })

await sdk.close()
