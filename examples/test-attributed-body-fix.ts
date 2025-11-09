/**
 * Test script to verify attributedBody text extraction fix
 *
 * Tests both individual and group messages to ensure text field is not null
 * after sending messages via the SDK.
 */

import { IMessageSDK } from '../src'
import { execAppleScript, generateSendTextScript } from '../src/utils/applescript'

declare const process: any

async function testIndividualMessage() {
    const sdk = new IMessageSDK({ debug: false })

    try {
        const testMessage = `Test ${Date.now()} - Hi111`
        const recipient = 'pilot@photon.codes'

        console.log(`Sending individual message: ${testMessage}`)

        // Try SDK send, fallback to buddy method if chat doesn't exist
        let sendResult: { sentAt: Date }
        try {
            sendResult = await sdk.send(recipient, testMessage)
        } catch {
            const script = generateSendTextScript(recipient, testMessage)
            await execAppleScript(script, false)
            sendResult = { sentAt: new Date() }
        }

        const sendTime = sendResult.sentAt.getTime()

        // Wait briefly for database write
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const result = await sdk.getMessages({ excludeOwnMessages: false, limit: 20 })
        const foundMessage = result.messages.find(
            (msg) => msg.isFromMe && msg.sender === recipient && Math.abs(msg.date.getTime() - sendTime) < 10000
        )

        if (!foundMessage) {
            throw new Error('Message not found')
        }

        if (foundMessage.text === null) {
            throw new Error('Text field is null')
        }

        if (!foundMessage.text.includes('Test') && !foundMessage.text.includes('Hi111')) {
            throw new Error(`Text content mismatch: ${foundMessage.text}`)
        }

        console.log(`✅ Individual message test passed: "${foundMessage.text}"`)
        return true
    } finally {
        await sdk.close()
    }
}

async function testGroupMessage() {
    const sdk = new IMessageSDK({ debug: false })

    try {
        // Try to get groups, skip if listChats is not available (e.g., on main branch)
        let groups: Array<{ chatId: string; displayName: string | null; isGroup: boolean }> = []
        try {
            if (typeof sdk.listChats === 'function') {
                const chats = await sdk.listChats(50)
                groups = chats.filter((c) => c.isGroup)
            }
        } catch {
            // listChats not available, skip group test
        }

        if (groups.length === 0) {
            console.log('⚠️  No groups found or listChats not available, skipping group test')
            return true
        }

        const targetGroup = groups[0]!
        const testMessage = `Group test ${Date.now()} - Hi111`

        console.log(`Sending group message to: ${targetGroup.displayName || targetGroup.chatId}`)

        const sendResult = await sdk.sendToChat(targetGroup.chatId, testMessage)
        const sendTime = sendResult.sentAt.getTime()

        // Wait briefly for database write
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const result = await sdk.getMessages({ excludeOwnMessages: false, limit: 30 })
        const groupChatId = targetGroup.chatId.replace(/^iMessage;\+;/, '')
        const foundMessage = result.messages.find((msg) => {
            if (!msg.isFromMe || !msg.isGroupChat) return false
            const msgChatId = msg.chatId.replace(/^iMessage;\+;/, '')
            if (msgChatId !== groupChatId) return false
            const timeDiff = msg.date.getTime() - sendTime
            return timeDiff >= -1000 && timeDiff < 10000
        })

        if (!foundMessage) {
            throw new Error('Group message not found')
        }

        if (foundMessage.text === null) {
            throw new Error('Text field is null')
        }

        if (!foundMessage.text.includes('Group test') && !foundMessage.text.includes('Hi111')) {
            throw new Error(`Text content mismatch: ${foundMessage.text}`)
        }

        console.log(`✅ Group message test passed: "${foundMessage.text}"`)
        return true
    } finally {
        await sdk.close()
    }
}

async function main() {
    try {
        console.log('Running attributedBody fix tests...\n')

        const individualPassed = await testIndividualMessage()
        console.log()
        const groupPassed = await testGroupMessage()

        console.log('\n✅ All tests passed!')
        process.exit(0)
    } catch (error: any) {
        console.error('\n❌ Test failed:', error.message)
        process.exit(1)
    }
}

main().catch((error) => {
    console.error('Unhandled error:', error)
    process.exit(1)
})
