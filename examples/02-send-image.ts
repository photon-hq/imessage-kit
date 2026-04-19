import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send image (local file path only — download remote URLs yourself first)
await sdk.send({
    to: 'pilot@photon.codes',
    text: 'Check this out',
    attachments: ['/path/to/image.jpg'],
})

// Multiple local files
await sdk.send({
    to: 'pilot@photon.codes',
    attachments: ['/path/to/photo.png', '/path/to/diagram.jpg'],
})

await sdk.close()
