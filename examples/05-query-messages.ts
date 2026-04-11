import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Get recent messages
const messages = await sdk.getMessages({ limit: 10 })
console.log(`Found ${messages.length} messages`)

// Get unread messages
const unread = await sdk.getMessages({ unreadOnly: true })
console.log(`${unread.length} unread messages`)

await sdk.close()
