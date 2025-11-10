import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Get recent messages
const result = await sdk.getMessages({ limit: 10 })
console.log(`Found ${result.total} messages`)

// Get unread messages
const unread = await sdk.getUnreadMessages()
console.log(`${unread.total} unread from ${unread.senderCount} senders`)

await sdk.close()
