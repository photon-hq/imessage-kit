/**
 * Test the original issue reproduction code from GitHub issue #2
 *
 * This reproduces the exact scenario from the issue:
 * - Send a message via sdk.send()
 * - Retrieve messages with excludeOwnMessages: false
 * - Verify that the sent message has a non-null text field
 */

import { IMessageSDK } from '../src'

declare const process: any

async function test() {
    try {
        const sdk = new IMessageSDK({
            debug: true,
            watcher: {
                pollInterval: 2000,
            },
        })

        // Send message (using a test recipient)
        await sdk.send('pilot@photon.codes', 'Hi111')

        // Wait for message to be stored in database
        await new Promise((resolve) => setTimeout(resolve, 2000))

        // Retrieve messages with excludeOwnMessages: false
        const result = await sdk.getMessages({ excludeOwnMessages: false, limit: 10 })

        console.log('\nRetrieved messages:')
        result.messages.forEach((msg, idx) => {
            console.log(`\nMessage ${idx + 1}:`)
            console.log(`  id: ${msg.id}`)
            console.log(`  guid: ${msg.guid}`)
            console.log(`  text: ${msg.text}`)
            console.log(`  is_from_me: ${msg.isFromMe}`)
            console.log(`  sender: ${msg.sender}`)
            console.log(`  date: ${msg.date.toISOString()}`)
        })

        // Check if the sent message has non-null text containing "Hi111"
        const sentMessage = result.messages.find(
            (msg) => msg.isFromMe && msg.text && msg.text.includes('Hi111')
        )

        if (sentMessage) {
            console.log('\n✅ SUCCESS: Found sent message with non-null text!')
            console.log(`   Text: "${sentMessage.text}"`)
            console.log('\n✅ Issue #2 is FIXED!')
        } else {
            const nullTextMessages = result.messages.filter((msg) => msg.isFromMe && msg.text === null)
            if (nullTextMessages.length > 0) {
                console.log('\n❌ FAILED: Found sent messages with null text:')
                nullTextMessages.forEach((msg) => {
                    console.log(`   ID: ${msg.id}, GUID: ${msg.guid}`)
                })
                console.log('\n❌ Issue #2 is NOT fixed')
                process.exit(1)
            } else {
                console.log('\n⚠️  Could not find the sent message in results')
            }
        }

        await sdk.close()
    } catch (error) {
        console.error('Error:', error)
        if (typeof process !== 'undefined') {
            process.exit(1)
        }
    }
}

test()

