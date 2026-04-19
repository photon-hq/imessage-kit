import { IMessageSDK, definePlugin } from '../src'

const myPlugin = definePlugin({
    name: 'my-plugin',
    onBeforeSend: ({ request }) => {
        console.log(`Sending to ${request.to}:`, request.text)
    },
    // Confirmation of "it landed in chat.db" arrives via onFromMe.
    onFromMe: ({ message }) => {
        console.log(`Landed: ${message.id}`)
    },
    onIncomingMessage: ({ message }) => {
        console.log(`New message: ${message.text}`)
    },
})

const sdk = new IMessageSDK({ plugins: [myPlugin] })

// Start watcher so onFromMe fires for our own sends.
await sdk.startWatching()

await sdk.send({ to: 'pilot@photon.codes', text: 'Test with plugin' })
await new Promise((r) => setTimeout(r, 2000))
await sdk.close()
