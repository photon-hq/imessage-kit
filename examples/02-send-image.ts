import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send image
await sdk.send('pilot@photon.codes', {
    text: 'Check this out',
    images: ['/path/to/image.jpg']
})

await sdk.close()
