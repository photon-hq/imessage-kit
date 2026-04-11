import { IMessageSDK, MessageScheduler } from '../src'

const sdk = new IMessageSDK()
const recipient = process.env.RECIPIENT || '+1234567890'

const scheduler = new MessageScheduler({
    sender: sdk,
    events: {
        onSent: (task) => console.log(`Sent: ${task.id}`),
        onError: (task, error) => console.error(`Failed ${task.id}: ${error.message}`),
        onComplete: (task) => console.log(`Completed: ${task.id}`),
    },
})

scheduler.start()

// One-time: 30 seconds from now
const id = scheduler.schedule({
    to: recipient,
    content: 'Reminder!',
    sendAt: new Date(Date.now() + 30_000),
})

// Recurring daily at 8am
const tomorrow8am = new Date()
tomorrow8am.setDate(tomorrow8am.getDate() + 1)
tomorrow8am.setHours(8, 0, 0, 0)

scheduler.scheduleRecurring({
    to: recipient,
    content: 'Good morning!',
    startAt: tomorrow8am,
    interval: 'daily',
})

// Manage
console.log(`Pending: ${scheduler.getPending().length}`)
scheduler.reschedule(id, new Date(Date.now() + 60_000))

process.on('SIGINT', async () => {
    scheduler.destroy()
    await sdk.close()
    process.exit(0)
})
