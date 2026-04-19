import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Single file with text
await sdk.send({
    to: 'pilot@photon.codes',
    text: 'Here is the report',
    attachments: ['/path/to/document.pdf'],
})

// Multiple files
await sdk.send({
    to: 'pilot@photon.codes',
    attachments: ['/data.csv', '/chart.png'],
})

await sdk.close()
