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

export { MessageChain } from './core/chain'
export {
    ConfigError,
    DatabaseError,
    type ErrorCode,
    IMessageError,
    PlatformError,
    SendError,
    WebhookError,
} from './core/errors'
export { IMessageSDK } from './core/sdk'
export type { SendOptions, SendToGroupOptions } from './core/sender'
// Watcher types
export type { WatcherEvents } from './core/watcher'
export { definePlugin, type Plugin, type PluginHooks } from './plugins/core'
export { type LoggerOptions, loggerPlugin } from './plugins/logger'
// Advanced types
export type {
    Mapper,
    Predicate,
    Recipient,
} from './types/advanced'
// Configuration types
export type {
    IMessageConfig,
    ResolvedConfig,
    RetryConfig,
    TempFileConfig,
    WatcherConfig,
    WebhookConfig,
} from './types/config'
// Message types
export type {
    Attachment,
    ChatSummary,
    Message,
    MessageFilter,
    MessageQueryResult,
    SendResult,
    ServiceType,
} from './types/message'

export { asRecipient, isMacOS, requireMacOS } from './utils/platform'
