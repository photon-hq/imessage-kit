import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send to multiple recipients
const results = await sdk.sendBatch([
    { to: 'user1@example.com', content: 'Hello User 1' },
    { to: 'user2@example.com', content: 'Hello User 2' },
    { to: 'user3@example.com', content: 'Hello User 3' }
])

console.log(`Sent ${results.length} messages`)

await sdk.close()
