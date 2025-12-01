/**
 * Example 15: Smart Reminders
 *
 * A user-friendly reminder system built on top of MessageScheduler.
 * Set reminders using natural language time expressions!
 */

import { IMessageSDK, Reminders } from '../src'

const sdk = new IMessageSDK()

// Create reminders with event handlers
const reminders = new Reminders(sdk, {
    onSent: (msg) => {
        console.log(`✅ Reminder sent: ${msg.id}`)
    },
    onError: (msg, error) => {
        console.error(`❌ Failed: ${error.message}`)
    },
})

const recipient = process.env.RECIPIENT || '+1234567890'

// ============================================
// Set reminders with human-readable times
// ============================================

// Relative time: "in X minutes/hours/days"
const r1 = reminders.in('30 seconds', recipient, 'Quick test reminder!')
console.log(`📌 Set reminder for 30 seconds: ${r1}`)

const r2 = reminders.in('1 minute', recipient, 'One minute has passed!')
console.log(`📌 Set reminder for 1 minute: ${r2}`)

// Specific time: "at 5pm", "tomorrow 9am", "friday 2pm"
// const r3 = reminders.at('5pm', recipient, 'End of day wrap-up')
// const r4 = reminders.at('tomorrow 9am', recipient, 'Good morning!')
// const r5 = reminders.at('friday 2pm', recipient, 'Weekly review time')

// ============================================
// List pending reminders
// ============================================
console.log('\n📋 Pending reminders:')
for (const r of reminders.list()) {
    console.log(`   - ${r.id}: "${r.message}" at ${r.scheduledFor.toLocaleTimeString()}`)
}

console.log(`\n⏳ Total: ${reminders.count()} reminders pending`)
console.log('📱 Watch your phone for messages!\n')

// ============================================
// Cleanup
// ============================================
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...')
    reminders.destroy()
    sdk.close()
    process.exit(0)
})

// Keep running
setTimeout(() => {
    console.log('\n✅ Demo complete!')
    reminders.destroy()
    sdk.close()
}, 90 * 1000)

