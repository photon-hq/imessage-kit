import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Single file with text
await sdk.send({
    to: 'recipient@example.com',
    text: 'Here is the report',
    attachments: ['/path/to/document.pdf'],
})

// Multiple files
await sdk.send({
    to: 'recipient@example.com',
    attachments: ['/data.csv', '/chart.png'],
})

await sdk.close()
