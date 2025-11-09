/**
 * List chats via AppleScript (no database access required)
 *
 * Usage:
 *   bun run examples/list-chats-applescript.ts
 *   Q="project" GROUPS_ONLY=true bun run examples/list-chats-applescript.ts
 */

import { execAppleScript } from '../src/utils/applescript'

declare const process: any

async function main() {
    const debug = (process.env.IMESSAGE_DEBUG ?? 'false').toLowerCase() === 'true'
    const groupsOnly = (process.env.GROUPS_ONLY ?? 'false').toLowerCase() === 'true'
    const query = (process.env.Q ?? '').toLowerCase()

    const script = `
tell application "Messages"
    set output to ""
    repeat with c in chats
        set cid to id of c
        set cname to ""
        try
            set cname to name of c
        end try
        set pCount to 0
        try
            set pCount to count of participants of c
        end try
        set kind to "DM"
        if pCount > 1 then set kind to "GROUP"
        set output to output & cid & "|" & cname & "|" & kind & "\n"
    end repeat
    return output
end tell
`.trim()

    try {
        const raw = await execAppleScript(script, debug)
        const lines = raw
            .split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0)

        const items = lines.map((line: string) => {
            const [cid, name, kind] = line.split('|')
            return {
                chatId: cid,
                displayName: name || null,
                isGroup: kind === 'GROUP',
            }
        })

        const filtered = items.filter((c) => {
            const matchGroup = groupsOnly ? c.isGroup : true
            const matchQuery = query ? (c.displayName ?? '').toLowerCase().includes(query) : true
            return matchGroup && matchQuery
        })

        console.log(
            `Found ${filtered.length} chats (AppleScript)${groupsOnly ? ' (groups only)' : ''}${
                query ? `, name contains "${query}"` : ''
            }`
        )

        for (const c of filtered) {
            console.log(`${c.isGroup ? 'GROUP' : 'DM'} | ${c.displayName ?? '(no name)'} | chatId=${c.chatId}`)
        }

        if (filtered.length) {
            console.log('\nExample: export the first chatId to environment:')
            console.log(`export CHAT_ID="${filtered[0].chatId}"`)
        }

        console.log('\nNote: On first run, macOS may prompt that the terminal wants to control “Messages”. Please allow.')
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('AppleScript list failed:', msg)
        console.error('Make sure the Messages app is open and logged into the same Apple ID.')
        throw error
    }
}

main().catch((err) => {
    if (typeof process !== 'undefined') {
        process.exit(1)
    }
})