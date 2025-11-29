#!/usr/bin/env bun
/**
 * 🎬 iMessage Kit - Scheduler Feature Demo
 * 
 * This demo showcases the MessageScheduler feature:
 * - Schedule messages for future delivery
 * - Recurring messages (daily, hourly, custom intervals)
 * - Cancel and reschedule on the fly
 * - Export/import for persistence
 * 
 * Run: bun run demo.ts
 */

import { IMessageSDK, MessageScheduler } from './src'

// ═══════════════════════════════════════════════════════════════════
// 📱 CONFIGURE YOUR RECIPIENT HERE
// ═══════════════════════════════════════════════════════════════════
const RECIPIENT = process.env.RECIPIENT || 'YOUR_PHONE_OR_EMAIL_HERE'
// Example: '+15551234567' or 'your@email.com'

if (RECIPIENT === 'YOUR_PHONE_OR_EMAIL_HERE') {
    console.log('\n⚠️  Please set your recipient first!\n')
    console.log('   Option 1: Edit demo.ts and change RECIPIENT')
    console.log('   Option 2: Run with: RECIPIENT="+1234567890" bun run demo.ts\n')
    process.exit(1)
}

// ═══════════════════════════════════════════════════════════════════
// 🚀 DEMO START
// ═══════════════════════════════════════════════════════════════════

console.log('\n')
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║         📱 iMessage Kit - Scheduler Feature Demo            ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log()

// Initialize SDK
const sdk = new IMessageSDK({ debug: false })
console.log('✅ SDK initialized\n')

// Create scheduler with event handlers
const scheduler = new MessageScheduler(
    sdk,
    { checkInterval: 500, debug: false },
    {
        onSent: (msg, result) => {
            console.log(`\n🎉 MESSAGE SENT!`)
            console.log(`   ID: ${msg.id}`)
            console.log(`   To: ${msg.to}`)
            console.log(`   Content: ${typeof msg.content === 'string' ? msg.content : msg.content.text}`)
            console.log(`   Sent at: ${result.sentAt.toLocaleTimeString()}`)
        },
        onError: (msg, error) => {
            console.error(`\n❌ SEND FAILED: ${msg.id}`)
            console.error(`   Error: ${error.message}`)
        },
        onComplete: (msg) => {
            console.log(`\n🏁 Recurring message completed: ${msg.id}`)
            console.log(`   Total sends: ${msg.sendCount}`)
        },
    }
)

console.log(`📬 Recipient: ${RECIPIENT}\n`)

// ─────────────────────────────────────────────────────────────────────
// Demo 1: Schedule a message for 10 seconds from now
// ─────────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('📅 DEMO 1: One-Time Scheduled Message')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

const sendTime1 = new Date(Date.now() + 10 * 1000)
const msg1 = scheduler.schedule({
    id: 'demo-welcome',
    to: RECIPIENT,
    content: '👋 Hello! This is a scheduled message from iMessage Kit!',
    sendAt: sendTime1,
})
console.log(`   ✓ Scheduled "${msg1}" for ${sendTime1.toLocaleTimeString()}`)
console.log(`   ⏱️  Sending in 10 seconds...\n`)

// ─────────────────────────────────────────────────────────────────────
// Demo 2: Schedule another message for 20 seconds
// ─────────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('📅 DEMO 2: Second Scheduled Message')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

const sendTime2 = new Date(Date.now() + 20 * 1000)
const msg2 = scheduler.schedule({
    id: 'demo-followup',
    to: RECIPIENT,
    content: '🚀 The scheduler supports multiple queued messages!',
    sendAt: sendTime2,
})
console.log(`   ✓ Scheduled "${msg2}" for ${sendTime2.toLocaleTimeString()}`)
console.log(`   ⏱️  Sending in 20 seconds...\n`)

// ─────────────────────────────────────────────────────────────────────
// Demo 3: Recurring message (every 15 seconds, 3 times)
// ─────────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('🔄 DEMO 3: Recurring Message (every 15s, stops after ~45s)')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

const recurringStart = new Date(Date.now() + 30 * 1000)
const recurringEnd = new Date(Date.now() + 75 * 1000)
const msg3 = scheduler.scheduleRecurring({
    id: 'demo-recurring',
    to: RECIPIENT,
    content: '🔔 Recurring reminder! (every 15 seconds)',
    startAt: recurringStart,
    interval: 15 * 1000, // 15 seconds
    endAt: recurringEnd,
})
console.log(`   ✓ Scheduled "${msg3}"`)
console.log(`   📍 Starts: ${recurringStart.toLocaleTimeString()}`)
console.log(`   🏁 Ends: ${recurringEnd.toLocaleTimeString()}`)
console.log(`   🔁 Interval: every 15 seconds\n`)

// ─────────────────────────────────────────────────────────────────────
// Show pending messages
// ─────────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('📋 PENDING MESSAGES')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
for (const msg of scheduler.getPending()) {
    const time = msg.type === 'recurring' ? msg.nextSendAt : msg.sendAt
    const typeLabel = msg.type === 'recurring' ? '🔄' : '📅'
    console.log(`   ${typeLabel} ${msg.id}: ${time.toLocaleTimeString()}`)
}
console.log()

// ─────────────────────────────────────────────────────────────────────
// Export feature demo
// ─────────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('💾 EXPORT FEATURE (for persistence)')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
const exported = scheduler.export()
console.log(`   Exported ${exported.scheduled.length} one-time + ${exported.recurring.length} recurring messages`)
console.log(`   This data can be saved to disk and restored later!\n`)

// ─────────────────────────────────────────────────────────────────────
// Wait for messages to send
// ─────────────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║  ⏳ Demo running... Watch your Messages app!                 ║')
console.log('║  📱 Messages will arrive over the next ~75 seconds          ║')
console.log('║  🛑 Press Ctrl+C to stop early                              ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log()

// Countdown timer
let remaining = 80
const countdown = setInterval(() => {
    remaining--
    if (remaining > 0 && remaining % 10 === 0) {
        console.log(`   ⏱️  ${remaining} seconds remaining...`)
    }
}, 1000)

// Auto-cleanup after demo
setTimeout(async () => {
    clearInterval(countdown)
    console.log('\n')
    console.log('╔══════════════════════════════════════════════════════════════╗')
    console.log('║  ✅ Demo complete!                                           ║')
    console.log('╚══════════════════════════════════════════════════════════════╝')
    scheduler.destroy()
    await sdk.close()
    process.exit(0)
}, 80 * 1000)

// Handle early exit
process.on('SIGINT', async () => {
    clearInterval(countdown)
    console.log('\n\n🛑 Demo stopped by user')
    scheduler.destroy()
    await sdk.close()
    process.exit(0)
})


