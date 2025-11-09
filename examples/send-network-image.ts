/**
 * Send Network Image Example
 * 
 * Demonstrates sending images from remote URLs.
 * The SDK will automatically download and attach the image.
 * 
 * Usage: bun run examples/send-network-image.ts [recipient1] [recipient2] ...
 * 
 * Examples:
 *   bun run examples/send-network-image.ts +1234567890
 *   bun run examples/send-network-image.ts user@example.com +1234567890
 */

import { IMessageSDK } from '../src'

declare const process: any

const DEFAULT_RECIPIENTS = ['', '']
const TEST_IMAGE_URL = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ101_rvvTSkJFf4eOyB-z0uHLbKgIPGBN1Iw&s'

function getRecipients(): string[] {
    if (typeof process !== 'undefined' && process.argv.length > 2) {
        return process.argv.slice(2)
    }
    return DEFAULT_RECIPIENTS
}

async function test() {
    const recipients = getRecipients()
    
    console.log('Recipients:', recipients.join(', '))
    console.log('Image URL:', TEST_IMAGE_URL)
    console.log()

    const sdk = new IMessageSDK({
        debug: process.env.IMESSAGE_DEBUG === 'true',
    })

    try {
        const startTime = Date.now()

        const results = await Promise.allSettled(
            recipients.map(async (recipient) => {
                console.log(`Sending to: ${recipient}`)
                const result = await sdk.send(recipient, { images: [TEST_IMAGE_URL] })
                console.log(`Success (${result.sentAt.toLocaleTimeString()})`)
                return { recipient, result }
            })
        )

        const successful = results.filter(r => r.status === 'fulfilled').length
        const failed = results.filter(r => r.status === 'rejected').length
        const duration = ((Date.now() - startTime) / 1000).toFixed(2)

        console.log(`\nDuration: ${duration}s, Success: ${successful}, Failed: ${failed}`)

        if (failed > 0) {
            results.forEach((result) => {
                if (result.status === 'rejected') {
                    console.log(`Failed: ${result.reason}`)
                }
            })
        }

        console.log('\nWaiting 5 seconds to ensure image uploads to iCloud...')
        await new Promise(r => setTimeout(r, 5000))

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
