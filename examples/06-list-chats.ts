import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// List all chats
const chats = await sdk.listChats({ limit: 20, sortBy: 'recent' })

for (const chat of chats) {
    console.log(`${chat.isGroup ? 'Group' : 'DM'}: ${chat.chatId}`)
    if (chat.unreadCount > 0) {
        console.log(`  ${chat.unreadCount} unread`)
    }
}

await sdk.close()
