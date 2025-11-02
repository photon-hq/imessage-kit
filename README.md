<div align="center">
  
![Banner](./.github/assets/banner.png)

# @photon-ai/imessage-kit

> A type-safe, elegant iMessage SDK for macOS with cross-runtime support

</div>

[![npm version](https://img.shields.io/npm/v/@photon-ai/imessage-kit.svg)](https://www.npmjs.com/package/@photon-ai/imessage-kit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-SSPL-blue.svg)](./LICENSE)

It lets you **read**, **send**, and **automate** iMessage conversations directly from Node.js or Bun.
Built for developers who want to integrate messaging into their **AI agents, automation scripts**, or **chat-first apps**, without AppleScript headaches.

> [!NOTE]
> **✨ Looking for advanced features like threaded replies, tapbacks, message editing or unsending, and live typing indicators? Or need enterprise-grade scalability? Check out our [Advanced iMessage Kit](https://github.com/photon-hq/advanced-imessage-kit).**

## Features

- **100% Type-safe** - Full TypeScript support with perfect type inference
- **Cross-Runtime** - Supports both Node.js and Bun with automatic runtime detection
- **Smart Database** - Uses native `bun:sqlite` for Bun, `better-sqlite3` for Node.js
- **Read Messages** - Query iMessage, SMS, and RCS messages with powerful filters
- **Send Messages** - Send text, images, and files (PDF, CSV, VCF, etc.)
- **Fluent API** - Elegant message chain processing
- **Real-time Watching** - Monitor new messages with webhook support (works even in Do Not Disturb mode)
- **Plugin System** - Extensible architecture for custom behaviors
- **Performance** - Concurrent message sending with semaphore control
- **Error Handling** - Comprehensive error types and type guards



## Hello, iMessage 
```typescript
import { IMessageSDK } from '@photon-ai/imessage-kit'

const sdk = new IMessageSDK()
await sdk.send('+1234567890', 'Hello from iMessage Kit!')
```




## Installation

```bash
# For Bun (zero dependencies)
bun add @photon-ai/imessage-kit

# For Node.js (requires better-sqlite3)
npm install @photon-ai/imessage-kit better-sqlite3
# or
yarn add @photon-ai/imessage-kit better-sqlite3
```

## Granting Permission

`IMessageKit` requires **Full Disk Access** to read your chat history and perform automation tasks.

Before starting, make sure to grant the necessary permissions to the IDE or terminal where you plan to run the program:

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Click the **“+”** button and **add** the IDE or terminal you are using.

In the example below, access has been granted to **Zed** and **Terminal**, allowing `IMessageKit` to function properly with both.

If you use other tools such as **Cursor**, **VS Code**, or **Warp**, make sure to grant them permission as well.

<p align="center">
  <img src="./.github/assets/instruction-1" width="49%">
  <img src="./.github/assets/instruction-2" width="49%">
</p>


## Quick Start

```typescript
import { IMessageSDK } from '@photon-ai/imessage-kit'

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
await sdk.send('+1234567890', { files: ['document.pdf', 'contact.vcf'] })
await sdk.send('+1234567890', { text: 'Check this out', images: ['photo.jpg'], files: ['data.csv'] })

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

// Send files (PDF, CSV, VCF, etc.)
await sdk.send('+1234567890', { 
    files: ['document.pdf', 'data.csv', 'contact.vcf'] 
})

// Send text with images and files
await sdk.send('+1234567890', { 
    text: 'Check these files',
    images: ['photo.jpg'],
    files: ['report.pdf']
})

// Send network images (auto-download)
await sdk.send('+1234567890', { 
    images: ['https://example.com/image.jpg'] 
})

// Convenience methods for files
await sdk.sendFile('+1234567890', '/path/to/document.pdf')
await sdk.sendFile('+1234567890', '/path/to/contact.vcf', 'Here is the contact')
await sdk.sendFiles('+1234567890', ['file1.pdf', 'file2.csv'], 'Multiple files')

// Batch sending
await sdk.sendBatch([
    { to: '+1111111111', content: 'Message 1' },
    { to: '+2222222222', content: { text: 'Message 2', images: ['img.jpg'] } },
    { to: '+3333333333', content: { files: ['document.pdf'] } }
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

// Filter by message type
await sdk.message(msg)
    .ifGroupChat()                      // Only process group messages
    .ifFromOthers()
    .replyText('Group reply!')
    .execute()
```

### Real-time Message Watching

```typescript
// Initialize SDK with custom watcher config
const sdk = new IMessageSDK({
    watcher: {
        pollInterval: 3000,  // Check every 3 seconds (default: 2000ms)
        unreadOnly: false     // Watch all messages (default: false)
                             // Set to true to only watch unread messages
    }
})

// Start watching for new messages
await sdk.startWatching({
    // Callback for 1-on-1 messages (default behavior)
    onNewMessage: async (message) => {
        console.log('New message:', message.text)
        
        // Auto-reply using chain API
        await sdk.message(message)
            .ifFromOthers()
            .replyText('Thanks for your message!')
            .execute()
    },
    
    // Optional: Handle group chat messages separately
    onGroupMessage: async (message) => {
        console.log('Group message from:', message.sender)
        console.log('Chat ID:', message.chatId)
        // Group chat logic here
    },
    
    // Error handler
    onError: (error) => {
        console.error('Watcher error:', error)
    }
})

// Stop watching when done
sdk.stopWatching()
```

**Message Type Handling:**
- `onNewMessage` - Receives 1-on-1 direct messages only
- `onGroupMessage` - Receives group chat messages (optional, ignored by default if not provided)
- Group messages are automatically filtered out unless you provide `onGroupMessage` callback

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
- **[send-files.ts](./examples/send-files.ts)** - Send files (PDF, CSV, VCF contact cards)
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

## Important Notes

### Message Watching Behavior

- **Default**: Monitors all new messages (both read and unread)
- **Works in Do Not Disturb mode**: The watcher uses timestamp-based detection instead of relying on read status
- **Configuration**: Set `unreadOnly: true` to only monitor unread messages (useful for user-triggered actions)
- **Recommendation**: For auto-reply bots, keep default `unreadOnly: false` to ensure all messages are captured

### Supported File Types

The SDK supports sending any file type that macOS Messages app accepts, including but not limited to:

- **Documents**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, RTF
- **Images**: JPG, PNG, GIF, HEIC, WEBP (auto-converted), AVIF (auto-converted)  
- **Contact Cards**: VCF (vCard format)
- **Data Files**: CSV, JSON, XML
- **Archives**: ZIP, RAR, 7Z
- **Media**: MP4, MOV, MP3, M4A
- **And more**: Any file format supported by macOS Messages

**Note**: Large files are automatically uploaded to iCloud when sending via iMessage. For SMS recipients, file size limits may apply depending on your carrier.

### Security

- This SDK reads from the local iMessage database
- No data is sent to external servers (except your webhook if configured)
- Network images are downloaded to temporary files and cleaned up automatically
- Always validate user input when building bots

## API Reference

### Main Methods

- `getMessages(filter?)` - Query messages with optional filters
- `getUnreadMessages()` - Get unread messages grouped by sender
- `send(to, content)` - Send text, images, and/or files
- `sendFile(to, filePath, text?)` - Send a single file
- `sendFiles(to, filePaths, text?)` - Send multiple files
- `sendBatch(messages)` - Send multiple messages concurrently
- `message(msg)` - Create message processing chain
- `startWatching(events?)` - Start monitoring new messages
- `stopWatching()` - Stop monitoring
- `use(plugin)` - Register plugin
- `close()` - Close SDK and release resources

### Message Object

Each message object includes:

```typescript
interface Message {
    id: string              // Message ID
    text: string | null     // Message text content
    sender: string          // Sender (phone/email)
    chatId: string          // Chat identifier
    isGroupChat: boolean    // Whether this is a group chat message
    isFromMe: boolean       // Whether sent by current user
    isRead: boolean         // Read status
    service: ServiceType    // 'iMessage' | 'SMS' | 'RCS'
    attachments: Attachment[]  // File attachments
    date: Date              // Message timestamp
}
```

### WatcherEvents

```typescript
interface WatcherEvents {
    onNewMessage?: (message: Message) => void | Promise<void>
    onGroupMessage?: (message: Message) => void | Promise<void>
    onError?: (error: Error) => void
}
```

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
