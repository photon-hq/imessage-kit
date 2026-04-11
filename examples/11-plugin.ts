import { IMessageSDK, definePlugin } from '../src'

// Create custom plugin
const myPlugin = definePlugin({
    name: 'my-plugin',
    onBeforeSend: ({ request }) => {
        console.log(`Sending to ${request.to}:`, request.text)
    },
    onAfterSend: ({ result }) => {
        console.log(`Sent at ${result.sentAt}`)
    },
    onNewMessage: ({ message }) => {
        console.log(`New message: ${message.text}`)
    }
})

const sdk = new IMessageSDK({
    plugins: [myPlugin]
})

await sdk.send('pilot@photon.codes', 'Test with plugin')
await sdk.close()
