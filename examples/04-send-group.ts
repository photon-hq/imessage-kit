import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send to group chat
await sdk.send('iMessage;+;chat493787071395575843', 'Hello everyone')

await sdk.close()
