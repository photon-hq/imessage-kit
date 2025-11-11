import { IMessageSDK, IMessageError } from '../src'

const sdk = new IMessageSDK()

try {
    await sdk.send('invalid-recipient', 'Test')
} catch (err: unknown) {
    if (err instanceof IMessageError) {
        console.error('SDK Error:', err.message)
        console.error('Error code:', err.code)
    } else if (err instanceof Error) {
        console.error('Error:', err.message)
    } else {
        console.error('Unknown error:', String(err))
    }
}

await sdk.close()
