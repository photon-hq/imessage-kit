/**
 * Penn Dining iMessage Bot — entry point.
 *
 * Usage:
 *   bun run bot.ts
 *
 * Requires:
 *   - Full Disk Access granted to your terminal
 *   - .env file with GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_PATH, ANTHROPIC_API_KEY
 */

import { IMessageSDK, MessageScheduler } from '@photon-ai/imessage-kit'
import { runAgent } from './agent.js'
import { markFollowupSent } from './tools/followup.js'

// ---------------------------------------------------------------------------
// Load environment variables from .env (Bun does this automatically)
// ---------------------------------------------------------------------------

const BOT_PHONE = process.env.BOT_PHONE ?? ''

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
    console.log('[PennEats] Starting Penn Dining iMessage Agent...')

    const sdk = new IMessageSDK({
        debug: false,
        watcher: {
            pollInterval: 3000,
            excludeOwnMessages: true,
        },
    })

    const scheduler = new MessageScheduler(
        sdk,
        { debug: true },
        {
            onSent: async (msg) => {
                // When a follow-up fires, mark it as sent in Sheets
                if (msg.id.length === 16) {
                    await markFollowupSent(msg.id).catch(console.error)
                }
            },
            onError: (msg, err) => {
                console.error(`[Scheduler] Failed to send ${msg.id}:`, err.message)
            },
        }
    )

    // Per-sender queue — ensures messages are processed in order without dropping any.
    // Each sender gets a promise chain; new messages are appended to the end of their chain.
    const queues = new Map<string, Promise<void>>()

    const enqueue = (sender: string, text: string) => {
        const tail = queues.get(sender) ?? Promise.resolve()
        const next = tail.then(async () => {
            try {
                console.log(`[PennEats] Message from ${sender}: ${text.slice(0, 80)}`)
                const reply = await runAgent({ phone: sender, text, scheduler })
                if (reply) {
                    await sdk.send(sender, reply)
                    console.log(`[PennEats] Replied to ${sender}: ${reply.slice(0, 80)}`)
                }
            } catch (err) {
                const msg2 = err instanceof Error ? err.message : String(err)
                console.error(`[PennEats] Error for ${sender}:`, msg2)
                await sdk.send(sender, "Sorry, something went wrong on my end. Try again in a sec!").catch(() => {})
            }
        })
        queues.set(sender, next)
        // Clean up the entry once the chain is idle
        next.then(() => {
            if (queues.get(sender) === next) queues.delete(sender)
        })
    }

    console.log('[PennEats] Bot is running. Text', BOT_PHONE || 'the bot number', 'to get started!')
    console.log('[PennEats] Try: "what\'s good for lunch?" or "heading to Hill House for dinner"')

    await sdk.startWatching({
        onDirectMessage: (msg) => {
            const text = msg.text?.trim()
            if (!text) return
            enqueue(msg.sender, text)
        },

        onError: (err) => {
            console.error('[PennEats] Watcher error:', err)
        },
    })

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n[PennEats] Shutting down...')
        scheduler.destroy()
        await sdk.close()
        process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}

main().catch((err) => {
    console.error('[PennEats] Fatal startup error:', err)
    process.exit(1)
})
