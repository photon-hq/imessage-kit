/**
 * Send to Group Chat Example
 *
 * This file demonstrates how to send messages to a group chat using chatId.
 * The unified send() method automatically detects chatId format.
 *
 * Usage: bun run examples/send-to-group.ts
 */

import { IMessageSDK } from '../src'

declare const process: any

async function main() {
    const sdk = new IMessageSDK({
        debug: true,
    })

    const chatId = process.env.CHAT_ID
    const text = process.env.TEXT
    const images = process.env.IMAGES?.split(',')
    const files = process.env.FILES?.split(',')

    if (!chatId) {
        console.error('Error: CHAT_ID environment variable is required')
        console.log('\nUsage:')
        console.log('  CHAT_ID="chat123..." TEXT="Hello" bun run examples/send-to-group.ts')
        console.log('  CHAT_ID="chat123..." IMAGES="/path/a.jpg,/path/b.png" bun run examples/send-to-group.ts')
        console.log('  CHAT_ID="chat123..." FILES="/path/report.pdf" bun run examples/send-to-group.ts')
        if (typeof process !== 'undefined') {
            process.exit(1)
        }
        return
    }

    try {
        if (text && !images && !files) {
            // Send text only
            console.log(`Sending text to group: ${chatId}`)
            await sdk.send(chatId, text)
        } else if (images || files) {
            // Send with attachments
            console.log(`Sending message with attachments to group: ${chatId}`)
            await sdk.send(chatId, {
                text,
                images,
                files,
            })
        } else {
            console.error('Error: Must provide TEXT, IMAGES, or FILES')
            if (typeof process !== 'undefined') {
                process.exit(1)
            }
            return
        }

        console.log('✓ Message sent successfully')
    } catch (error) {
        console.error('Error:', error)
        if (typeof process !== 'undefined') {
            process.exit(1)
        }
    } finally {
        await sdk.close()
    }
}

main()
