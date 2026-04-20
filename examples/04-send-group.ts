import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Never hand-write a chatId — always get it from the SDK.
const groups = await sdk.listChats({ kind: 'group', limit: 1 })
const group = groups[0]

if (!group) {
    console.log('No group chats found')
} else {
    await sdk.send({ to: group.chatId, text: 'Hello everyone' })
}

await sdk.close()
