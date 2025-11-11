import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Send file
await sdk.send('pilot@photon.codes', {
    text: 'Document attached',
    files: ['/path/to/document.pdf']
})

await sdk.close()
