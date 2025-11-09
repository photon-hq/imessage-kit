/**
 * Send a message to a group chat by chatId (GUID) or group name
 *
 * Usage examples:
 *   CHAT_ID="<group-guid>" TEXT="Test message" bun run examples/send-to-group.ts
 *   GROUP_NAME="Project" TEXT="Hello everyone" bun run examples/send-to-group.ts
 *   GROUP_NAME="Project" TEXT="Please check" IMAGES="/path/a.jpg,/path/b.png" bun run examples/send-to-group.ts
 *   GROUP_NAME="Project" FILES="/path/a.pdf" bun run examples/send-to-group.ts
 */

import { IMessageSDK } from '../src'
import type { IMessageDatabase } from '../src/core/database'

declare const process: any

function parseListEnv(name: string): string[] {
    const v = process.env[name]
    if (!v) return []
    return v
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
}

async function resolveChatId(sdk: IMessageSDK): Promise<string> {
    const chatIdFromEnv = process.env.CHAT_ID
    if (chatIdFromEnv) return chatIdFromEnv

    const groupName = process.env.GROUP_NAME
    const limit = parseInt(process.env.LIMIT ?? '200', 10)

    if (!groupName) {
        throw new Error('You must provide CHAT_ID (group GUID) or GROUP_NAME (name keyword)')
    }

    const chats = await sdk.listChats(limit)
    const q = groupName.toLowerCase()
    const match = chats.find((c) => c.isGroup && (c.displayName ?? '').toLowerCase().includes(q))

    if (!match) {
        throw new Error(`No group chat found, name contains: ${groupName}`)
    }

    return match.chatId
}

async function main() {
    const debug = (process.env.IMESSAGE_DEBUG ?? 'false').toLowerCase() === 'true'
    const text = process.env.TEXT ?? 'Hello, this is a test message from imessage-kit'
    const files = parseListEnv('FILES')
    const images = parseListEnv('IMAGES')

    const chatIdFromEnv = process.env.CHAT_ID
    const databasePath = process.env.IMESSAGE_DB

    // If CHAT_ID (group GUID) is provided, inject a dummy database to avoid local chat.db permission issues
    const sdk = chatIdFromEnv
        ? new IMessageSDK({ debug }, { database: { close: async () => {} } as unknown as IMessageDatabase })
        : new IMessageSDK({ debug, databasePath })

    try {
        const chatId = await resolveChatId(sdk)
        const content = files.length || images.length ? { text, files, images } : text

        console.log(`Sending to group: ${chatId}`)
        const result = await sdk.sendToChat(chatId, content)
        console.log(`Sent at: ${result.sentAt.toLocaleString()}`)
    } catch (error) {
        console.error('Send failed:', error)
        throw error
    } finally {
        await sdk.close()
    }
}

main().catch((_err) => {
    if (typeof process !== 'undefined') {
        process.exit(1)
    }
})
