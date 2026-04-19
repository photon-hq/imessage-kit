/**
 * Correlate a send with its chat.db row.
 *
 * `sdk.send()` resolves on AppleScript dispatch — it does not return a
 * Message object. To observe the row (and later delivery transitions),
 * subscribe to `onFromMeMessage`.
 */
import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

const text = `hello-${Date.now()}`

await sdk.startWatching({
    onFromMeMessage: (msg) => {
        if (msg.text === text) {
            console.log('Landed:', msg.id)
            console.log('Delivered:', msg.isDelivered)
        }
    },
})

await sdk.send({ to: 'pilot@photon.codes', text })

// Give the watcher a moment to observe the row
await new Promise((r) => setTimeout(r, 3_000))

await sdk.close()
