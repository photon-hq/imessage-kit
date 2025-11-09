/**
 * Send "Hello World!" Message Example
 *
 * Usage: bun run examples/send-hello-world.ts [recipient1] [recipient2] ...
 *
 * Examples:
 *   bun run examples/send-hello-world.ts +1234567890
 *   bun run examples/send-hello-world.ts user@example.com +1234567890
 */

import { IMessageSDK } from '../src'

declare const process: any

const DEFAULT_RECIPIENTS = ['', '']
const MESSAGE = '!dlroW olleH'

function getRecipients(): string[] {
    if (typeof process !== 'undefined' && process.argv.length > 2) {
        return process.argv.slice(2)
    }
    return DEFAULT_RECIPIENTS
}

async function test() {
    const recipients = getRecipients()

    console.log('Recipients:', recipients.join(', '))
    console.log('Message:', MESSAGE)
    console.log()

    const sdk = new IMessageSDK({
        debug: process.env.IMESSAGE_DEBUG === 'true',
    })

    try {
        const startTime = Date.now()

        const results = await Promise.allSettled(
            recipients.map(async (recipient) => {
                console.log(`Sending to: ${recipient}`)
                const result = await sdk.send(recipient, MESSAGE)
                console.log(`Success (${result.sentAt.toLocaleTimeString()})`)
                return { recipient, result }
            })
        )

        const successful = results.filter((r) => r.status === 'fulfilled').length
        const failed = results.filter((r) => r.status === 'rejected').length
        const duration = ((Date.now() - startTime) / 1000).toFixed(2)

        console.log(`\nDuration: ${duration}s, Success: ${successful}, Failed: ${failed}`)

        if (failed > 0) {
            results.forEach((result) => {
                if (result.status === 'rejected') {
                    console.log(`Failed: ${result.reason}`)
                }
            })
        }

        console.log('Done\n')
    } catch (error) {
        console.error('Test failed:', error)
        throw error
    } finally {
        await sdk.close()
    }
}

test().catch((error) => {
    console.error('Error:', error)
    if (typeof process !== 'undefined') {
        process.exit(1)
    }
})
