import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send image (local file or URL)
await sdk.send('pilot@photon.codes', {
    text: 'Check this out',
    attachments: ['/path/to/image.jpg'],
})

// Send remote image (auto-downloaded)
await sdk.send('pilot@photon.codes', {
    attachments: ['https://example.com/photo.png'],
})

await sdk.close()
