import { IMessageSDK, Reminders } from '../src'

const sdk = new IMessageSDK()
const recipient = process.env.RECIPIENT || '+1234567890'

const reminders = new Reminders(sdk, {
    onSent: (task) => console.log(`Sent: ${task.id}`),
    onError: (_, error) => console.error(`Failed: ${error.message}`),
})

// Relative time
reminders.in('5 minutes', recipient, 'Take a break!')
reminders.in('2 hours', recipient, 'Call the client')

// Specific time
reminders.at('5pm', recipient, 'End of day wrap-up')
reminders.at('tomorrow 9am', recipient, 'Morning standup')

// Manage
console.log(`${reminders.count()} reminders pending`)
for (const r of reminders.list()) {
    console.log(`  ${r.message} — ${r.scheduledFor.toLocaleTimeString()}`)
}

process.on('SIGINT', async () => {
    reminders.destroy()
    await sdk.close()
    process.exit(0)
})
