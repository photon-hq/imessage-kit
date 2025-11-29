/**
 * Example 14: Scheduled Messages
 *
 * Demonstrates how to schedule messages for future delivery,
 * including one-time and recurring messages.
 */

import { IMessageSDK, MessageScheduler } from '../src'

const sdk = new IMessageSDK({ debug: true })

// Create a scheduler with event handlers
const scheduler = new MessageScheduler(
    sdk,
    { debug: true, checkInterval: 1000 },
    {
        onSent: (msg, result) => {
            console.log(`✅ Message sent: ${msg.id}`)
            console.log(`   Sent at: ${result.sentAt}`)
        },
        onError: (msg, error) => {
            console.error(`❌ Failed to send ${msg.id}: ${error.message}`)
        },
        onComplete: (msg) => {
            console.log(`🏁 Recurring message completed: ${msg.id} (sent ${msg.sendCount} times)`)
        },
    }
)

// ============================================
// Example 1: Schedule a message for 30 seconds from now
// ============================================
const recipient = 'pilot@photon.codes' // Replace with actual recipient

const reminder = scheduler.schedule({
    to: recipient,
    content: 'Hey! Just a friendly reminder 👋',
    sendAt: new Date(Date.now() + 30 * 1000), // 30 seconds from now
})
console.log(`📅 Scheduled reminder: ${reminder}`)

// ============================================
// Example 2: Schedule a message with attachments
// ============================================
const withAttachment = scheduler.schedule({
    to: recipient,
    content: {
        text: 'Check out this photo!',
        images: ['/path/to/image.jpg'], // Replace with actual path
    },
    sendAt: new Date(Date.now() + 60 * 1000), // 1 minute from now
})
console.log(`📅 Scheduled message with attachment: ${withAttachment}`)

// ============================================
// Example 3: Schedule recurring daily message
// ============================================
const tomorrow8am = new Date()
tomorrow8am.setDate(tomorrow8am.getDate() + 1)
tomorrow8am.setHours(8, 0, 0, 0)

const goodMorning = scheduler.scheduleRecurring({
    to: recipient,
    content: 'Good morning! ☀️ Have a great day!',
    startAt: tomorrow8am,
    interval: 'daily',
    // Optionally set an end date:
    // endAt: new Date('2025-12-31'),
})
console.log(`📅 Scheduled daily good morning: ${goodMorning}`)

// ============================================
// Example 4: Schedule recurring with custom interval
// ============================================
const everyHour = scheduler.scheduleRecurring({
    to: recipient,
    content: 'Hourly check-in 🕐',
    startAt: new Date(Date.now() + 5 * 60 * 1000), // Start in 5 minutes
    interval: 'hourly',
    endAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // End in 24 hours
})
console.log(`📅 Scheduled hourly check-in: ${everyHour}`)

// ============================================
// Example 5: Custom interval (every 15 minutes)
// ============================================
const every15Min = scheduler.scheduleRecurring({
    to: recipient,
    content: 'Quick update! 📊',
    startAt: new Date(Date.now() + 2 * 60 * 1000),
    interval: 15 * 60 * 1000, // 15 minutes in milliseconds
    endAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // End in 2 hours
})
console.log(`📅 Scheduled every 15 minutes: ${every15Min}`)

// ============================================
// View pending messages
// ============================================
console.log('\n📋 Pending messages:')
for (const msg of scheduler.getPending()) {
    const sendTime = msg.type === 'recurring' ? msg.nextSendAt : msg.sendAt
    console.log(`   - ${msg.id}: ${sendTime.toLocaleString()} (${msg.type})`)
}

// ============================================
// Reschedule a message
// ============================================
const newTime = new Date(Date.now() + 45 * 1000)
if (scheduler.reschedule(reminder, newTime)) {
    console.log(`\n🔄 Rescheduled ${reminder} to ${newTime.toLocaleString()}`)
}

// ============================================
// Cancel a message
// ============================================
if (scheduler.cancel(withAttachment)) {
    console.log(`\n🚫 Cancelled ${withAttachment}`)
}

// ============================================
// Export/Import for persistence
// ============================================
const exportedData = scheduler.export()
console.log('\n💾 Exported data:', JSON.stringify(exportedData, null, 2))

// You could save this to a file and restore it later:
// import { writeFileSync, readFileSync } from 'fs'
// writeFileSync('scheduled.json', JSON.stringify(exportedData))
// const restored = JSON.parse(readFileSync('scheduled.json', 'utf-8'))
// scheduler.import(restored)

// ============================================
// Cleanup
// ============================================
console.log('\n⏳ Scheduler running... Press Ctrl+C to stop')

process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...')
    scheduler.destroy()
    await sdk.close()
    console.log('👋 Goodbye!')
    process.exit(0)
})


