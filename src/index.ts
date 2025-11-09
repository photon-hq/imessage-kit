/**
 * @photon-ai/imessage-kit - macOS iMessage Development Kit
 *
 * @example
 * ```ts
 * import { IMessageSDK, type IMessageConfig, type Message } from '@photon-ai/imessage-kit'
 *
 * const sdk = new IMessageSDK({
 *   debug: true,
 *   webhook: { url: 'https://your-server.com/webhook' }
 * })
 *
 * // Get unread messages
 * const unread = await sdk.getUnreadMessages()
 * for (const { sender, messages } of unread) {
 *   console.log(`${sender}: ${messages.length} messages`)
 * }
 *
 * // Send messages
 * await sdk.send('+1234567890', 'Hello')
 * await sdk.send('+1234567890', { images: ['/path/to/image.jpg'] })
 * await sdk.send('+1234567890', { files: ['/path/to/document.pdf'] })
 * await sdk.sendFile('+1234567890', '/path/to/contact.vcf', 'Contact info')
 *
 * // Chain message processing
 * await sdk.startWatching({
 *   onNewMessage: async (msg: Message) => {
 *     await sdk.message(msg)
 *       .ifFromOthers()
 *       .matchText(/hello/i)
 *       .replyText('Hi!')
 *       .execute()
 *   }
 * })
 * ```
 */

export { IMessageSDK } from './core/sdk'
export { MessageChain } from './core/chain'

// Configuration types
export type {
    IMessageConfig,
    ResolvedConfig,
    WebhookConfig,
    WatcherConfig,
    RetryConfig,
    TempFileConfig,
} from './types/config'

// Message types
export type {
    Message,
    Attachment,
    ServiceType,
    MessageFilter,
    MessageQueryResult,
    SendResult,
} from './types/message'

// Advanced types
export type {
    Recipient,
    Predicate,
    Mapper,
} from './types/advanced'

// Watcher types
export type { WatcherEvents } from './core/watcher'

export { definePlugin, type Plugin, type PluginHooks } from './plugins/core'
export { loggerPlugin, type LoggerOptions } from './plugins/logger'

export {
    IMessageError,
    PlatformError,
    DatabaseError,
    SendError,
    WebhookError,
    ConfigError,
    type ErrorCode,
} from './core/errors'

export { requireMacOS, isMacOS, asRecipient } from './utils/platform'
