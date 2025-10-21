# @photon-ai/imessage-kit

> A type-safe, elegant iMessage SDK for macOS with cross-runtime support

[![npm version](https://img.shields.io/npm/v/@photon-ai/imessage-kit.svg)](https://www.npmjs.com/package/@photon-ai/imessage-kit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-SSPL-blue.svg)](./LICENSE)

## Features

- **100% Type-safe** - Full TypeScript support with perfect type inference
- **Cross-Runtime** - Supports both Node.js and Bun with automatic runtime detection
- **Smart Database** - Uses native `bun:sqlite` for Bun, `better-sqlite3` for Node.js
- **Read Messages** - Query iMessage, SMS, and RCS messages with powerful filters
- **Send Messages** - Send text and images (local files or network URLs)
- **Fluent API** - Elegant message chain processing
- **Real-time Watching** - Monitor new messages with webhook support
- **Plugin System** - Extensible architecture for custom behaviors
- **Performance** - Concurrent message sending with semaphore control
- **Error Handling** - Comprehensive error types and type guards

## Installation

```bash
# For Bun (zero dependencies)
bun add @photon-ai/imessage-kit

# For Node.js (requires better-sqlite3)
npm install @photon-ai/imessage-kit better-sqlite3
# or
yarn add @photon-ai/imessage-kit better-sqlite3
```

## Quick Start

```typescript
import { IMessageSDK, type IMessage } from '@photon-ai/imessage-kit'

// Initialize SDK (works in both Node.js and Bun)
const sdk = new IMessageSDK({
    debug: true,
    maxConcurrent: 5
})

// Get unread messages
const unreadMessages = await sdk.getUnreadMessages()
for (const { sender, messages } of unreadMessages) {
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
    since: new Date('2025-10-20')
})

// Get unread messages grouped by sender
const unread = await sdk.getUnreadMessages()
for (const { sender, messages } of unread) {
    console.log(`${sender}: ${messages.length} unread`)
}
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
// Initialize SDK with custom watcher config
const sdk = new IMessageSDK({
    watcher: {
        pollInterval: 3000,  // Check every 3 seconds (default: 2000ms)
        unreadOnly: true      // Only watch for unread messages (default: true)
    }
})

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
    }
})

// Stop watching when done
sdk.stopWatching()
```

### Webhook Integration

```typescript
const sdk = new IMessageSDK({
    webhook: {
        url: 'https://your-server.com/webhook',
        headers: { 'Authorization': 'Bearer token' }
    }
})

await sdk.startWatching()
// Webhook receives: { event, message, timestamp }
```

## Plugin System

Extend SDK functionality with plugins:

```typescript
import { loggerPlugin } from '@photon-ai/imessage-kit'

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

### Configuration Options

```typescript
const sdk = new IMessageSDK({
    debug: true,                     // Enable debug logging
    maxConcurrent: 10,               // Max concurrent sends
    scriptTimeout: 30000,            // AppleScript timeout (ms)
    databasePath: '/custom/path',    // Custom database path
    plugins: [loggerPlugin()]        // Plugins
})
```

### Error Handling

```typescript
import { SendError, DatabaseError } from '@photon-ai/imessage-kit'

try {
    await sdk.send('+1234567890', 'Hello')
} catch (error) {
    if (error instanceof SendError) {
        console.error('Send failed:', error.message)
    }
}
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
npm install
# or
bun install

# Run tests
npm test        # runs bun test
# or
bun test

# Run tests with coverage
bun test --coverage

# Build
npm run build
# or
bun run build

# Lint
npm run lint
# or
bun run lint

# Type check
npm run type-check
# or
bun run type-check
```

## Requirements

- **OS**: macOS only (accesses iMessage database)
- **Runtime**: Node.js >= 18.0.0 or Bun >= 1.0.0
- **Database Driver**: 
  - **Bun**: Uses built-in `bun:sqlite` (no extra dependencies)
  - **Node.js**: Requires `better-sqlite3` (install separately)
- **Permissions**: Read access to `~/Library/Messages/chat.db`

> **Note**: The SDK automatically detects your runtime and uses the appropriate database driver.

## Security Notes

- This SDK reads from the local iMessage database
- No data is sent to external servers (except your webhook if configured)
- Network images are downloaded to temporary files and cleaned up automatically
- Always validate user input when building bots

## API Reference

### Main Methods

- `getMessages(filter?)` - Query messages with optional filters
- `getUnreadMessages()` - Get unread messages grouped by sender
- `send(to, content)` - Send text and/or images
- `sendBatch(messages)` - Send multiple messages concurrently
- `message(msg)` - Create message processing chain
- `startWatching(events?)` - Start monitoring new messages
- `stopWatching()` - Stop monitoring
- `use(plugin)` - Register plugin
- `close()` - Close SDK and release resources

For full TypeScript definitions, see the [types](./src/types) directory.

## License

This project is licensed under the [Server Side Public License v1 (SSPL)](./LICENSE) with additional restrictions.

### Prohibited Use

**You may NOT use this software to create competing products or services**, including but not limited to:
- iMessage/SMS/RCS messaging SDKs or APIs
- Messaging automation platforms
- Similar messaging libraries for macOS

### Permitted Use

You MAY use this software for:
- Internal business operations and automation
- Personal projects and non-commercial applications  
- Educational and research purposes
- Integration where messaging is not the core feature

For the complete license terms, see the [LICENSE](./LICENSE) file.

---

**Note**: This SDK is for educational and development purposes. Always respect user privacy and follow Apple's terms of service.
