# @sg-hq/imessage-kit

> A type-safe, elegant iMessage SDK for macOS with zero dependencies

[![npm version](https://img.shields.io/npm/v/@sg-hq/imessage-kit.svg)](https://www.npmjs.com/package/@sg-hq/imessage-kit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## Features

- **100% Type-safe** - Full TypeScript support with perfect type inference
- **Zero Dependencies** - Pure TypeScript implementation (only `bun:sqlite` for database)
- **Read Messages** - Query iMessage, SMS, and RCS messages with powerful filters
- **Send Messages** - Send text and images (local files or network URLs)
- **Fluent API** - Elegant message chain processing
- **Real-time Watching** - Monitor new messages with webhook support
- **Plugin System** - Extensible architecture for custom behaviors
- **Performance** - Concurrent message sending with semaphore control
- **Error Handling** - Comprehensive error types and type guards

## Installation

```bash
bun add @sg-hq/imessage-kit
# or
npm install @sg-hq/imessage-kit
```

## Quick Start

```typescript
import { IMessageSDK, type IMessage } from '@sg-hq/imessage-kit'

// Initialize SDK
const sdk = new IMessageSDK({
    debug: true,
    maxConcurrent: 5
})

// Get unread messages
const unreadMessages = await sdk.getUnreadMessages()
for (const [sender, messages] of unreadMessages) {
    console.log(`${sender}: ${messages.length} unread messages`)
}

// Send messages (unified API)
await sdk.send('+1234567890', 'Hello!')
await sdk.send('+1234567890', { images: ['photo.jpg'] })
await sdk.send('+1234567890', { text: 'Check this out', images: ['photo.jpg'] })

// Always close when done
await sdk.close()
```

## Core APIs

### Reading Messages

```typescript
// Get all messages
const result = await sdk.getMessages()
console.log(`Total: ${result.total}, Retrieved: ${result.messages.length}`)

// Filter messages
const filtered = await sdk.getMessages({
    sender: '+1234567890',
    unreadOnly: true,
    service: 'iMessage',
    limit: 20,
    since: new Date('2024-01-01')
})

// Get unread messages grouped by sender
const unread = await sdk.getUnreadMessages()
for (const [sender, messages] of unread) {
    console.log(`${sender}: ${messages.length} unread`)
}

// Get unread count
const count = await sdk.getUnreadCount()
console.log(`Total unread: ${count}`)
```

### Sending Messages

```typescript
// Unified send API
await sdk.send(recipient, content)

// Send text only
await sdk.send('+1234567890', 'Hello World!')

// Send images only
await sdk.send('+1234567890', { 
    images: ['image1.jpg', 'image2.png'] 
})

// Send text with images
await sdk.send('+1234567890', { 
    text: 'Check these photos',
    images: ['photo.jpg']
})

// Send network images (auto-download)
await sdk.send('+1234567890', { 
    images: ['https://example.com/image.jpg'] 
})

// Batch sending
await sdk.sendBatch([
    { to: '+1111111111', content: 'Message 1' },
    { to: '+2222222222', content: { text: 'Message 2', images: ['img.jpg'] } }
])
```

### Message Chain Processing

The SDK provides a fluent API for elegant message processing:

```typescript
// Auto-reply example
await sdk.message(msg)
    .ifFromOthers()                    // Only process messages from others
    .matchText(/hello/i)               // Match text pattern
    .replyText('Hi there!')            // Reply with text
    .execute()                         // Must call execute()

// Complex conditions
await sdk.message(msg)
    .ifFromOthers()
    .ifUnread()
    .when(m => m.sender.startsWith('+1'))
    .do(async (m) => {
        console.log('Processing:', m.text)
    })
    .replyText('Received!')
    .execute()

// Reply with images
await sdk.message(msg)
    .ifFromOthers()
    .matchText('photo')
    .replyImage(['photo.jpg', 'photo2.jpg'])
    .execute()
```

### Real-time Message Watching

```typescript
// Start watching for new messages
await sdk.startWatching({
    // Callback for new messages
    onNewMessage: async (message) => {
        console.log('New message:', message.text)
        
        // Auto-reply using chain API
        await sdk.message(message)
            .ifFromOthers()
            .replyText('Thanks for your message!')
            .execute()
    },
    
    // Error handler
    onError: (error) => {
        console.error('Watcher error:', error)
    },
    
    // Polling interval (default: 2000ms)
    interval: 3000
})

// Check watcher status
const status = sdk.getWatcherStatus()
console.log('Watching:', status.isWatching)

// Stop watching
sdk.stopWatching()
```

### Webhook Integration

```typescript
// Start watching with webhook
await sdk.startWatching({
    webhook: {
        url: 'https://your-server.com/webhook',
        secret: 'your-secret-key',
        headers: {
            'X-Custom-Header': 'value'
        }
    },
    onNewMessage: async (msg) => {
        console.log('New message:', msg.text)
    }
})
```

## Plugin System

Extend SDK functionality with plugins:

```typescript
import { loggerPlugin } from '@sg-hq/imessage-kit'

// Use built-in logger plugin
sdk.use(loggerPlugin({
    level: 'info',
    prefix: '[iMessage]'
}))

// Create custom plugin
const customPlugin = {
    name: 'my-plugin',
    onInit: async () => {
        console.log('Plugin initialized')
    },
    onBeforeSend: async (to, content) => {
        console.log('Sending to:', to)
        return { to, content }
    },
    onAfterSend: async (result) => {
        console.log('Send result:', result)
    },
    onDestroy: async () => {
        console.log('Plugin destroyed')
    }
}

sdk.use(customPlugin)
```

## Advanced Usage

### Type-safe Configuration

```typescript
import { type IMessage } from '@sg-hq/imessage-kit'

// Use type namespace (Elysia-style)
const config: IMessage.Config = {
    debug: true,
    maxConcurrent: 10,
    scriptTimeout: 30000,
    databasePath: '/path/to/chat.db',
    plugins: [loggerPlugin()]
}

const sdk = new IMessageSDK(config)
```

### Error Handling

```typescript
import { 
    IMessageError,
    PlatformError, 
    DatabaseError, 
    SendError 
} from '@sg-hq/imessage-kit'

try {
    await sdk.send('+1234567890', 'Hello')
} catch (error) {
    if (error instanceof SendError) {
        console.error('Failed to send:', error.message)
    } else if (error instanceof DatabaseError) {
        console.error('Database error:', error.message)
    } else if (IMessageError.is(error)) {
        console.error(`Error [${error.code}]:`, error.message)
    }
}
```

### Message Filters

```typescript
const result = await sdk.getMessages({
    sender: '+1234567890',          // Filter by sender
    service: 'iMessage',             // 'iMessage' | 'SMS' | 'RCS'
    unreadOnly: true,                // Only unread messages
    limit: 50,                       // Limit results
    since: new Date('2024-01-01')   // Messages after date
})
```

## Examples

Check the `examples/` directory for complete examples:

- **[send-hello-world.ts](./examples/send-hello-world.ts)** - Basic message sending
- **[send-network-image.ts](./examples/send-network-image.ts)** - Send images from URLs
- **[auto-reply.ts](./examples/auto-reply.ts)** - Auto-reply bot with chain API
- **[advanced.ts](./examples/advanced.ts)** - Advanced features showcase

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests with coverage
bun test --coverage

# Build
bun run build

# Lint
bun run lint

# Type check
bun run type-check
```

## Requirements

- **OS**: macOS only (accesses iMessage database)
- **Runtime**: Node.js >= 18.0.0 or Bun
- **Permissions**: Read access to `~/Library/Messages/chat.db`

## Security Notes

- This SDK reads from the local iMessage database
- No data is sent to external servers (except your webhook if configured)
- Network images are downloaded to temporary files and cleaned up automatically
- Always validate user input when building bots

## API Reference

### IMessageSDK

#### Methods

- `getMessages(filter?: MessageFilter): Promise<MessageQueryResult>`
- `getUnreadMessages(): Promise<Map<string, Message[]>>`
- `getUnreadCount(): Promise<number>`
- `send(to: string, content: string | SendContent): Promise<SendResult>`
- `sendBatch(messages: BatchMessage[]): Promise<SendResult[]>`
- `message(msg: Message): MessageChain`
- `startWatching(config: WatchConfig): Promise<void>`
- `stopWatching(): void`
- `getWatcherStatus(): WatcherStatus`
- `use(plugin: Plugin): this`
- `close(): Promise<void>`

### Types

See TypeScript definitions for complete type information:

```typescript
import type { 
    IMessage,
    Message, 
    MessageFilter,
    SendContent,
    SendResult,
    Plugin 
} from '@sg-hq/imessage-kit'
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT © GreatSomething

---

**Note**: This SDK is for educational and development purposes. Always respect user privacy and follow Apple's terms of service.
