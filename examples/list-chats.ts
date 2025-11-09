/**
 * List chats to discover chatId (including group GUIDs)
 *
 * Usage examples:
 *   bun run examples/list-chats.ts
 *   LIMIT=300 bun run examples/list-chats.ts
 *   Q="project" bun run examples/list-chats.ts
 *   GROUPS_ONLY=false bun run examples/list-chats.ts
 */

import { IMessageSDK } from '../src'

declare const process: any

async function main() {
    const debug = (process.env.IMESSAGE_DEBUG ?? 'false').toLowerCase() === 'true'
    const limit = parseInt(process.env.LIMIT ?? '200', 10)
    const groupsOnly = (process.env.GROUPS_ONLY ?? 'true').toLowerCase() === 'true'
    const query = (process.env.Q ?? '').toLowerCase()

    const databasePath = process.env.IMESSAGE_DB
    const sdk = new IMessageSDK({ debug, databasePath })

    try {
        const chats = await sdk.listChats(limit)

        const filtered = chats.filter((c) => {
            const matchGroup = groupsOnly ? c.isGroup : true
            const matchQuery = query ? (c.displayName ?? '').toLowerCase().includes(query) : true
            return matchGroup && matchQuery
        })

        console.log(
            `Found ${filtered.length} chats${groupsOnly ? ' (groups only)' : ''}${
                query ? `, name contains "${query}"` : ''
            }`
        )

        for (const c of filtered) {
            const last = c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : 'N/A'
            console.log(
                `${c.isGroup ? 'GROUP' : 'DM'} | ${c.displayName ?? '(no name)'} | chatId=${c.chatId} | last=${last}`
            )
        }

        if (filtered.length) {
            console.log('\nExample: export the first chatId to environment:')
            console.log(`export CHAT_ID="${filtered[0].chatId}"`)
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('Failed to list chats:', msg)
        if (/authorization denied|permission|not permitted/i.test(msg)) {
            console.error('\nHint: grant Full Disk Access to your terminal or Bun.')
            console.error('System Settings → Privacy & Security → Full Disk Access:')
            console.error('1) Add and enable Terminal or iTerm')
            console.error('2) If it still fails, add the Bun executable as well (use `which bun`)')
            console.error('Restart the terminal and try again.')
        }
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
