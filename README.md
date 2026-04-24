<div align="center">
  
![Banner](./.github/assets/banner.png)

# @photon-ai/imessage-kit

> A type-safe, elegant iMessage SDK for macOS with cross-runtime support

</div>

[![npm version](https://img.shields.io/npm/v/@photon-ai/imessage-kit.svg)](https://www.npmjs.com/package/@photon-ai/imessage-kit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/bZd4CMd2H5)

A full-featured iMessage SDK for **reading**, **sending**, and **automating** iMessage conversations on macOS. Perfect for building AI agents, automation tools, and chat-first applications.

> [!NOTE]
> **✨ Looking for advanced features like threaded replies, tapbacks, message editing, unsending, live typing indicators? Check out [Advanced iMessage Kit](https://github.com/photon-hq/advanced-imessage-kit) and contact us at daniel@photon.codes.**

---

## Features

| Feature | Method | Example |
|---------|--------|---------|
| [Send Messages](#send-messages) | `sdk.send()` | [01-send-text.ts](./examples/01-send-text.ts) |
| [Send Images](#send-images) | `sdk.send()` | [02-send-image.ts](./examples/02-send-image.ts) |
| [Send Files](#send-files) | `sdk.sendFile()` | [03-send-file.ts](./examples/03-send-file.ts) |
| [Send to Groups](#send-to-groups) | `sdk.send()` | [04-send-group.ts](./examples/04-send-group.ts) |
| [Query Messages](#query-messages) | `sdk.getMessages()` | [05-query-messages.ts](./examples/05-query-messages.ts) |
| [List Chats](#list-chats) | `sdk.listChats()` | [06-list-chats.ts](./examples/06-list-chats.ts) |
| [Real-time Watching](#real-time-watching) | `sdk.startWatching()` | [07-watch-messages.ts](./examples/07-watch-messages.ts) |
| [Auto Reply](#auto-reply) | `sdk.message()` | [08-auto-reply.ts](./examples/08-auto-reply.ts) |
| Batch Send | `sdk.sendBatch()` | [09-batch-send.ts](./examples/09-batch-send.ts) |
| Get Sent Message | `sdk.send()` | [10-get-sent-message.ts](./examples/10-get-sent-message.ts) |
| [Plugin System](#plugin-system) | `sdk.use()` | [11-plugin.ts](./examples/11-plugin.ts) |
| [Error Handling](#error-handling) | `SendError` | [12-error-handling.ts](./examples/12-error-handling.ts) |
| Watch Own Messages | `sdk.startWatching()` | [13-watch-own-messages.ts](./examples/13-watch-own-messages.ts) |
| [Scheduled Messages](#scheduled-messages) | `MessageScheduler` | [14-scheduled-messages.ts](./examples/14-scheduled-messages.ts) |
| [Smart Reminders](#smart-reminders) | `Reminders` | [15-smart-reminders.ts](./examples/15-smart-reminders.ts) |

---

## Quick Start

### Installation

```bash
# For Bun (zero dependencies)
bun add @photon-ai/imessage-kit

# For Node.js (requires better-sqlite3)
npm install @photon-ai/imessage-kit better-sqlite3
```

### Basic Usage

```typescript
import { IMessageSDK } from '@photon-ai/imessage-kit'

const sdk = new IMessageSDK()

// Send a message
await sdk.send('+1234567890', 'Hello from iMessage Kit!')

// Clean up
await sdk.close()
```

### Configuration

```typescript
interface IMessageConfig {
    debug?: boolean              // Enable debug logging
    maxConcurrent?: number       // Max concurrent sends (default: 5)
    scriptTimeout?: number       // AppleScript timeout in ms
    databasePath?: string        // Custom database path
    plugins?: Plugin[]           // Plugins
    watcher?: {
        pollInterval?: number    // Polling interval (default: 2000)
        unreadOnly?: boolean     // Only watch unread (default: false)
        excludeOwnMessages?: boolean  // Exclude own messages (default: true)
    }
    webhook?: {
        url: string
        headers?: Record<string, string>
    }
}
```

### Granting Permission

`IMessageKit` requires **Full Disk Access** to read your chat history and perform automation tasks.

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **"+"** and add your IDE or terminal (e.g., Cursor, VS Code, Terminal, Warp)

---

## Messages

> Examples: [01-send-text.ts](./examples/01-send-text.ts) | [02-send-image.ts](./examples/02-send-image.ts) | [03-send-file.ts](./examples/03-send-file.ts) | [05-query-messages.ts](./examples/05-query-messages.ts)

### Send Messages

```typescript
// Send text
await sdk.send('+1234567890', 'Hello World!')

// Send to email
await sdk.send('user@example.com', 'Hello!')
```

### Send Images

```typescript
// Send local images
await sdk.send('+1234567890', { 
    images: ['image1.jpg', 'image2.png'] 
})

// Send network images (auto-download)
await sdk.send('+1234567890', { 
    images: ['https://example.com/image.jpg'] 
})

// Text with images
await sdk.send('+1234567890', { 
    text: 'Check this out!',
    images: ['photo.jpg']
})
```

### Send Files

```typescript
// Send files (PDF, CSV, VCF, etc.)
await sdk.send('+1234567890', { 
    files: ['document.pdf', 'data.csv', 'contact.vcf'] 
})

// Convenience methods
await sdk.sendFile('+1234567890', '/path/to/document.pdf')
await sdk.sendFiles('+1234567890', ['file1.pdf', 'file2.csv'], 'Multiple files')
```

### Query Messages

```typescript
// Get messages with filters
const result = await sdk.getMessages({
    sender: '+1234567890',
    unreadOnly: true,
    limit: 20,
    since: new Date('2025-01-01'),
    search: 'meeting'
})

// Get unread messages grouped by sender
const unread = await sdk.getUnreadMessages()
console.log(`${unread.total} unread from ${unread.senderCount} senders`)
```

---

## Chats

> Examples: [04-send-group.ts](./examples/04-send-group.ts) | [06-list-chats.ts](./examples/06-list-chats.ts)

### List Chats

```typescript
// Get all chats
const all = await sdk.listChats()

// Filter chats
const groups = await sdk.listChats({
    type: 'group',
    hasUnread: true,
    sortBy: 'recent',
    search: 'Project',
    limit: 20
})

// Each chat includes
for (const chat of groups) {
    console.log({
        chatId: chat.chatId,
        name: chat.displayName,
        isGroup: chat.isGroup,
        unread: chat.unreadCount
    })
}
```

### Send to Groups

```typescript
// Get group chatId from listChats()
const groups = await sdk.listChats({ type: 'group' })
const chatId = groups[0].chatId  // e.g., 'chat45e2b868...'

// Send to group
await sdk.send(chatId, 'Hello group!')
await sdk.send(chatId, {
    text: 'Check these files',
    files: ['report.pdf']
})
```

---

## Real-time Events

> Examples: [07-watch-messages.ts](./examples/07-watch-messages.ts) | [08-auto-reply.ts](./examples/08-auto-reply.ts) | [13-watch-own-messages.ts](./examples/13-watch-own-messages.ts)

### Real-time Watching

```typescript
await sdk.startWatching({
    // All messages
    onMessage: (msg) => {
        console.log(`New: ${msg.text}`)
    },
    
    // DMs only
    onDirectMessage: (msg) => {
        console.log(`DM from ${msg.sender}`)
    },
    
    // Groups only
    onGroupMessage: (msg) => {
        console.log(`Group: ${msg.chatId}`)
    },
    
    onError: (error) => {
        console.error(error)
    }
})

// Stop watching
sdk.stopWatching()
```

### Auto Reply

```typescript
await sdk.startWatching({
    onDirectMessage: async (msg) => {
        await sdk.message(msg)
            .ifFromOthers()
            .matchText(/hello/i)
            .replyText('Hi there!')
            .execute()
    }
})
```

### Message Chain API

```typescript
await sdk.message(msg)
    .ifUnread()
    .ifNotReaction()   // Skip tapback reactions
    .ifGroupChat()
    .when(m => m.sender.startsWith('+1'))
    .matchText(/photo/i)
    .replyImage(['photo.jpg'])
    .execute()
```

---

## Attachments

> Examples: [02-send-image.ts](./examples/02-send-image.ts) | [03-send-file.ts](./examples/03-send-file.ts)

### Attachment Helpers

```typescript
import {
    attachmentExists,
    downloadAttachment,
    getAttachmentSize,
    isImageAttachment,
    isVideoAttachment,
    isAudioAttachment
} from '@photon-ai/imessage-kit'

const msg = await sdk.getMessages({ hasAttachments: true, limit: 1 })
const attachment = msg.messages[0].attachments[0]

if (await attachmentExists(attachment)) {
    const size = await getAttachmentSize(attachment)
    
    if (isImageAttachment(attachment)) {
        await downloadAttachment(attachment, '/path/to/save.jpg')
    }
}
```

### Supported File Types

- **Documents**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, RTF
- **Images**: JPG, PNG, GIF, HEIC, WEBP, AVIF
- **Contact Cards**: VCF (vCard)
- **Data Files**: CSV, JSON, XML
- **Archives**: ZIP, RAR, 7Z
- **Media**: MP4, MOV, MP3, M4A

---

## Scheduling

> Examples: [14-scheduled-messages.ts](./examples/14-scheduled-messages.ts) | [15-smart-reminders.ts](./examples/15-smart-reminders.ts)

### Scheduled Messages

```typescript
import { IMessageSDK, MessageScheduler } from '@photon-ai/imessage-kit'

const sdk = new IMessageSDK()
const scheduler = new MessageScheduler(sdk, { debug: true }, {
    onSent: (msg, result) => console.log(`✅ Sent: ${msg.id}`),
    onError: (msg, error) => console.error(`❌ Failed: ${error.message}`),
    onComplete: (msg) => console.log(`🏁 Completed: ${msg.id}`)
})

// One-time message
const id = scheduler.schedule({
    to: '+1234567890',
    content: 'Reminder!',
    sendAt: new Date(Date.now() + 5 * 60 * 1000)  // 5 minutes
})

// Recurring daily
scheduler.scheduleRecurring({
    to: '+1234567890',
    content: 'Good morning! ☀️',
    startAt: new Date('2025-01-01T08:00:00'),
    interval: 'daily',  // 'hourly' | 'daily' | 'weekly' | 'monthly' | number
    endAt: new Date('2025-12-31')
})

// Manage
scheduler.reschedule(id, newDate)
scheduler.cancel(id)
scheduler.getPending()

// Persistence
const data = scheduler.export()
scheduler.import(data)

// Cleanup
scheduler.destroy()
```

### Smart Reminders

A human-friendly wrapper for scheduling with natural language:

```typescript
import { IMessageSDK, Reminders } from '@photon-ai/imessage-kit'

const sdk = new IMessageSDK()
const reminders = new Reminders(sdk)

// Relative time
reminders.in('5 minutes', '+1234567890', 'Take a break!')
reminders.in('2 hours', '+1234567890', 'Call the client')
reminders.in('1 day', '+1234567890', 'Follow up')

// Specific time
reminders.at('5pm', '+1234567890', 'End of day review')
reminders.at('tomorrow 9am', '+1234567890', 'Morning standup')
reminders.at('friday 2pm', '+1234567890', 'Weekly sync')

// Exact date
reminders.exact(new Date('2025-12-25T10:00:00'), '+1234567890', 'Merry Christmas!')

// Manage
reminders.list()    // List pending
reminders.count()   // Count pending
reminders.cancel(id)
reminders.destroy()
```

**Supported formats:**
- Duration: `"5 minutes"`, `"2 hours"`, `"1 day"`, `"30 seconds"`, `"1 week"`
- Time: `"5pm"`, `"5:30pm"`, `"17:30"`
- Day + Time: `"tomorrow 9am"`, `"friday 2pm"`

---

## Plugin System

> Example: [11-plugin.ts](./examples/11-plugin.ts)

```typescript
import { loggerPlugin } from '@photon-ai/imessage-kit'

// Built-in logger
sdk.use(loggerPlugin({
    level: 'info',
    colored: true
}))

// Custom plugin
sdk.use({
    name: 'my-plugin',
    onInit: async () => console.log('Initialized'),
    onBeforeSend: async (to, content) => {
        console.log('Sending to:', to)
        return { to, content }
    },
    onAfterSend: async (result) => {
        console.log('Sent:', result)
    },
    onDestroy: async () => console.log('Destroyed')
})
```

---

## Error Handling

> Example: [12-error-handling.ts](./examples/12-error-handling.ts)

```typescript
import { SendError, DatabaseError, PlatformError } from '@photon-ai/imessage-kit'

try {
    await sdk.send('+1234567890', 'Hello')
} catch (error) {
    if (error instanceof SendError) {
        console.error('Send failed:', error.message)
    } else if (error instanceof DatabaseError) {
        console.error('Database error:', error.message)
    } else if (error instanceof PlatformError) {
        console.error('Platform error:', error.message)
    }
}
```

---

## Examples

Run any example with Bun:

```bash
bun run examples/<filename>.ts
```

### Getting Started
- [01-send-text.ts](./examples/01-send-text.ts) - Basic text message
- [02-send-image.ts](./examples/02-send-image.ts) - Send images
- [03-send-file.ts](./examples/03-send-file.ts) - Send files

### Message Operations
- [05-query-messages.ts](./examples/05-query-messages.ts) - Query messages
- [09-batch-send.ts](./examples/09-batch-send.ts) - Batch sending
- [10-get-sent-message.ts](./examples/10-get-sent-message.ts) - Get sent message

### Chats & Groups
- [04-send-group.ts](./examples/04-send-group.ts) - Send to group
- [06-list-chats.ts](./examples/06-list-chats.ts) - List chats

### Real-time & Automation
- [07-watch-messages.ts](./examples/07-watch-messages.ts) - Watch messages
- [08-auto-reply.ts](./examples/08-auto-reply.ts) - Auto-reply bot
- [13-watch-own-messages.ts](./examples/13-watch-own-messages.ts) - Watch own messages

### Scheduling
- [14-scheduled-messages.ts](./examples/14-scheduled-messages.ts) - Scheduled messages
- [15-smart-reminders.ts](./examples/15-smart-reminders.ts) - Smart reminders

### Advanced
- [11-plugin.ts](./examples/11-plugin.ts) - Custom plugin
- [12-error-handling.ts](./examples/12-error-handling.ts) - Error handling

---

## API Reference

### Core Methods

| Method | Description |
|--------|-------------|
| `getMessages(filter?)` | Query messages with filters |
| `getUnreadMessages()` | Get unread messages grouped by sender |
| `listChats(options?)` | List chats with filtering/sorting |
| `send(to, content)` | Send text, images, and/or files |
| `sendFile(to, path, text?)` | Send a single file |
| `sendFiles(to, paths, text?)` | Send multiple files |
| `sendBatch(messages)` | Send multiple messages concurrently |
| `message(msg)` | Create message processing chain |
| `startWatching(events?)` | Start monitoring new messages |
| `stopWatching()` | Stop monitoring |
| `use(plugin)` | Register plugin |
| `close()` | Close SDK and release resources |

### Types

```typescript
interface Message {
    id: string
    guid: string
    text: string | null
    sender: string
    senderName: string | null
    chatId: string
    isGroupChat: boolean
    isFromMe: boolean
    isRead: boolean
    service: 'iMessage' | 'SMS' | 'RCS'
    attachments: Attachment[]
    date: Date
    // Reaction fields
    isReaction: boolean
    reactionType: 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question' | null
    isReactionRemoval: boolean
    associatedMessageGuid: string | null
}

interface SendResult {
    sentAt: Date
    message?: Message  // Available if watcher is running
}
```

---

## Requirements

- **OS**: macOS only
- **Runtime**: Node.js >= 18.0.0 or Bun >= 1.0.0
- **Permissions**: Full Disk Access

---

## LLMs

Download `llms.txt` for language model context:

- [Download llms.txt](./llms.txt)

### Context7 MCP

- [Context7 Docs](https://context7.com/photon-hq/imessage-kit)

Add [Context7 MCP](https://context7.com/docs/installation) to your IDE, then use:

```
use context7: photon-hq/imessage-kit
```

---

## License

[MIT License](./LICENSE)

---

**Note**: This SDK is for educational and development purposes. Always respect user privacy and follow Apple's terms of service.
