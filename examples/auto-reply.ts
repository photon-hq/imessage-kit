/**
 * Auto-Reply Bot Example
 *
 * Behaviors:
 * 1. Text received -> Reply with "original text + hello" + Send network image
 * 2. Image received -> Send the image back
 *
 * Usage: bun run examples/auto-reply.ts
 */

import { type Attachment, IMessageSDK, type Message } from '../src'

declare const process: any

const NETWORK_IMAGE = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ101_rvvTSkJFf4eOyB-z0uHLbKgIPGBN1Iw&s'
const processedIds = new Set<string>()

async function main() {
    const sdk = new IMessageSDK({
        debug: true,
        watcher: {
            pollInterval: 2000,
        },
    })

    await sdk.startWatching({
        onDirectMessage: async (msg: Message) => {
            if (processedIds.has(msg.id)) {
                return
            }

            processedIds.add(msg.id)

            // Prevent memory leak by limiting processed IDs cache size
            if (processedIds.size > 1000) {
                const ids = Array.from(processedIds)
                processedIds.clear()
                ids.slice(-500).forEach((id) => {
                    processedIds.add(id)
                })
            }

            console.log(`\n[${new Date().toLocaleTimeString()}] New message from: ${msg.sender}`)

            try {
                // Handle image attachments
                if (msg.attachments.length > 0) {
                    const images = msg.attachments.filter((a: Attachment) => a.isImage)
                    for (const image of images) {
                        console.log(`  Sending image back: ${image.filename}`)
                        await sdk.send(msg.sender, { images: [image.path] })
                        await new Promise((r) => setTimeout(r, 500))
                    }
                }

                // Handle text messages
                if (msg.text?.trim()) {
                    console.log(`  Received text: ${msg.text}`)
                    const reply = `${msg.text} hello`
                    await sdk.send(msg.sender, reply)
                    console.log(`  Replied: ${reply}`)

                    await new Promise((r) => setTimeout(r, 500))

                    await sdk.send(msg.sender, { images: [NETWORK_IMAGE] })
                    console.log(`  Sent network image`)
                }
            } catch (error) {
                console.error(`  Error: ${error}`)
            }
        },

        onError: (error) => {
            console.error(`Error: ${error.message}`)
        },
    })

    const stopHandler = async () => {
        console.log('\nStopping...')
        sdk.stopWatching()
        await sdk.close()
        console.log('Stopped\n')
        if (typeof process !== 'undefined') {
            process.exit(0)
        }
    }

    if (typeof process !== 'undefined') {
        process.on('SIGINT', stopHandler)
        process.on('SIGTERM', stopHandler)
    }
}

main().catch((error) => {
    console.error('Error:', error)
    if (typeof process !== 'undefined') {
        process.exit(1)
    }
})
