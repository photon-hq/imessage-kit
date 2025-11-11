import { IMessageSDK, definePlugin } from '../src'

// Create custom plugin
const myPlugin = definePlugin({
    name: 'my-plugin',
    onBeforeSend: (to, content) => {
        console.log(`Sending to ${to}:`, content.text)
    },
    onAfterSend: (to, result) => {
        console.log(`Sent at ${result.sentAt}`)
    },
    onNewMessage: (msg) => {
        console.log(`New message: ${msg.text}`)
    }
})

const sdk = new IMessageSDK({
    plugins: [myPlugin]
})

await sdk.send('pilot@photon.codes', 'Test with plugin')
await sdk.close()
