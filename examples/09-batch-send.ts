import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send to multiple recipients
const result = await sdk.sendBatch([
    { to: 'user1@example.com', text: 'Hello User 1' },
    { to: 'user2@example.com', text: 'Hello User 2' },
    { to: 'user3@example.com', text: 'Hello User 3' },
])

console.log(`Sent: ${result.sent}, Failed: ${result.failed}, Skipped: ${result.skipped}`)

await sdk.close()
