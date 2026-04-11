import { IMessageSDK } from '../src'

const sdk = new IMessageSDK()

// Convenience method for single file
await sdk.sendFile('pilot@photon.codes', '/path/to/document.pdf', 'Here is the report')

// Multiple files
await sdk.sendFiles('pilot@photon.codes', ['/data.csv', '/chart.png'])

await sdk.close()
