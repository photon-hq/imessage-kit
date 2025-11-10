/**
 * Advanced Examples - IMessage SDK
 *
 * This file demonstrates advanced usage patterns including:
 * - Plugin system and configuration
 * - Type-safe recipient validation
 * - Fluent message chain processing
 * - Auto-reply bot implementation
 * - Batch operations
 * - Resource cleanup with Symbol.dispose
 */

import { asRecipient, IMessageSDK, loggerPlugin } from '../src/index'

// ==================== Create SDK Instance (with plugins) ====================

const sdk = new IMessageSDK({
    plugins: [
        loggerPlugin({
            level: 'info',
            colored: true,
            timestamp: true,
            logSend: true,
            logNewMessage: true,
        }),
    ],
    debug: true,
})

// ==================== Basic Message Sending ====================

async function exampleSendMessage() {
    console.log('\n=== Send Message Example ===\n')

    try {
        // Send a simple text message
        const result = await sdk.send('+1234567890', 'Hello!')
        console.log('[OK] Message sent successfully:', result.sentAt)
    } catch (error) {
        console.error('[ERROR] Failed to send message:', error)
    }
}

// ==================== Recipient Validation ====================

async function exampleBrandedTypes() {
    console.log('\n=== Recipient Validation Example ===\n')

    // Validate recipient format (supports both phone numbers and emails)
    const phone = asRecipient('+1234567890')
    const email = asRecipient('user@example.com')

    // Use validated recipients
    await sdk.send(phone, 'Message to phone number')
    await sdk.send(email, 'Message to email address')

    // Invalid format will throw an error
    // await sdk.send('invalid', 'This will fail')  // [ERROR] Not a valid phone or email
}

// ==================== Fluent Chain Message Processing ====================

async function exampleFluentChain() {
    console.log('\n=== Fluent Chain Processing Example ===\n')

    const result = await sdk.getMessages({ unreadOnly: true })

    // Process each message with fluent chain API
    for (const message of result.messages) {
        await sdk
            .message(message)
            .ifUnread()
            .matchText(/hello|hi/i)
            .replyText((m) => `Hi ${m.sender}! Thanks for your message.`)
    }
}

// ==================== Advanced Message Processing ====================

async function exampleAdvancedProcessing() {
    console.log('\n=== Advanced Processing Example ===\n')

    const result = await sdk.getMessages()

    // Process messages with attachments
    for (const message of result.messages) {
        if (message.attachments.length > 0) {
            await sdk.message(message).replyText('Thanks for the message with attachments!')
        }
    }
}

// ==================== Auto-Reply Bot ====================

async function exampleAutoReplyBot() {
    console.log('\n=== Auto-Reply Bot Example ===\n')

    await sdk.startWatching({
        onDirectMessage: async (message) => {
            console.log(`[MSG] New message from: ${message.sender}`)

            await sdk
                .message(message)
                .matchText(/^\/help$/i)
                .replyText('Available commands:\n/help - Show this help\n/time - Show current time')

            await sdk
                .message(message)
                .matchText(/^\/time$/i)
                .replyText(() => `Current time: ${new Date().toLocaleString('en-US')}`)
        },

        onError: (error) => {
            console.error('Watcher error:', error)
        },
    })

    console.log('[OK] Auto-reply bot started')
}

// ==================== Batch Operations ====================

async function exampleBatchOperations() {
    console.log('\n=== Batch Operations Example ===\n')

    // Method 1: Process unread messages in sequence
    const result = await sdk.getMessages({ unreadOnly: true })

    for (const msg of result.messages) {
        await sdk.message(msg).replyText('Thanks for your message!')
    }

    // Method 2: Send batch messages with concurrency control
    const recipients = ['+1234567890', '+0987654321', 'user@example.com']
    const batchResults = await sdk.sendBatch(
        recipients.map((to) => ({
            to,
            content: 'Batch message notification',
        }))
    )

    // Check batch results
    for (const result of batchResults) {
        if (result.success) {
            console.log(`[OK] Sent to ${result.to}`)
        } else {
            console.error(`[ERROR] Failed to send to ${result.to}:`, result.error?.message)
        }
    }

    console.log('[OK] Batch processing completed')
}

// ==================== Automatic Cleanup with Symbol.dispose ====================

async function exampleAutoCleanup() {
    console.log('\n=== Auto Cleanup Example ===\n')

    {
        // Using TypeScript 5.2+ "await using" syntax
        // SDK will be automatically cleaned up when the scope exits
        await using localSdk = new IMessageSDK()

        const unread = await localSdk.getUnreadMessages()
        console.log(`Unread messages: ${unread.length} sender(s)`)
    }

    console.log('SDK automatically cleaned up (resources released)')
}

// ==================== Message Filtering and Query ====================

async function exampleMessageFiltering() {
    console.log('\n=== Message Filtering Example ===\n')

    // Query with various filters
    const recentMessages = await sdk.getMessages({
        limit: 10,
        unreadOnly: false,
    })
    console.log(`Found ${recentMessages.messages.length} recent messages`)

    // Query only unread messages
    const unreadMessages = await sdk.getMessages({
        unreadOnly: true,
    })
    console.log(`Found ${unreadMessages.messages.length} unread messages`)

    // Get unread messages grouped by sender
    const groupedUnread = await sdk.getUnreadMessages()
    console.log(`Unread messages from ${groupedUnread.length} sender(s):`)
    for (const { sender, messages } of groupedUnread) {
        console.log(`  - ${sender}: ${messages.length} message(s)`)
    }
}

// ==================== Error Handling ====================

async function exampleErrorHandling() {
    console.log('\n=== Error Handling Example ===\n')

    try {
        // Attempt to send to invalid recipient
        await sdk.send('invalid-recipient', 'This will fail')
    } catch (error) {
        if (error instanceof Error) {
            console.error('[ERROR] Caught error:', error.message)
        }
    }

    // Batch send with error handling
    const results = await sdk.sendBatch([
        { to: '+1234567890', content: 'Valid message' },
        { to: 'invalid', content: 'Invalid recipient' },
    ])

    for (const result of results) {
        if (!result.success) {
            console.error(`[ERROR] Failed to send to ${result.to}:`, result.error?.message)
        }
    }
}

// ==================== Run All Examples ====================

async function main() {
    try {
        console.log('='.repeat(60))
        console.log('Starting IMessage SDK Advanced Examples')
        console.log('='.repeat(60))

        await exampleSendMessage()
        await exampleBrandedTypes()
        await exampleFluentChain()
        await exampleAdvancedProcessing()
        await exampleMessageFiltering()
        await exampleBatchOperations()
        await exampleErrorHandling()
        await exampleAutoCleanup()

        console.log('\n' + '='.repeat(60))
        console.log('All examples completed successfully!')
        console.log('='.repeat(60))
    } catch (error) {
        console.error('\n[FATAL] Example execution failed:', error)
        process.exit(1)
    } finally {
        await sdk.close()
        console.log('\n[OK] SDK closed and resources released')
    }
}

// Run examples (uncomment to execute)
// main()

// Export for testing
export {
    exampleSendMessage,
    exampleBrandedTypes,
    exampleFluentChain,
    exampleAdvancedProcessing,
    exampleAutoReplyBot,
    exampleBatchOperations,
    exampleAutoCleanup,
    exampleMessageFiltering,
    exampleErrorHandling,
}
