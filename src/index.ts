/**
 * @photon-ai/imessage-kit - macOS iMessage 开发工具包
 *
 * @example
 * ```ts
 * import { IMessageSDK, type IMessageConfig, type Message } from '@photon-ai/imessage-kit'
 *
 * const config: IMessageConfig = {
 *   webhook: { url: 'https://your-server.com/webhook' }
 * }
 * const sdk = new IMessageSDK(config)
 *
 * /// 获取未读消息
 * const unread = await sdk.getUnreadMessages()
 * for (const { sender, messages } of unread) {
 *   console.log(`${sender}: ${messages.length}条`)
 * }
 *
 * /// 发送消息
 * await sdk.send('+1234567890', 'Hello')
 * await sdk.send('+1234567890', { images: ['/path/to/image.jpg'] })
 *
 * /// 链式处理消息
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

// Core SDK
export { IMessageSDK } from './core/sdk'
export { MessageChain } from './core/chain'

// Configuration Types
export type {
    IMessageConfig,
    ResolvedConfig,
    WebhookConfig,
    WatcherConfig,
    RetryConfig,
    TempFileConfig,
} from './types/config'

// Message Types
export type { Message, Attachment, ServiceType, MessageFilter, SendResult } from './types/message'

// Advanced Types
export type { Recipient, Predicate, Mapper } from './types/advanced'

// Plugin System
export { definePlugin, type Plugin, type PluginHooks } from './plugins/core'
export { loggerPlugin, type LoggerOptions } from './plugins/logger'

// Watcher Types
export type { WatcherEvents, MessageCallback } from './core/watcher'

// Error Handling
export {
    IMessageError,
    PlatformError,
    DatabaseError,
    SendError,
    WebhookError,
    ConfigError,
    type ErrorCode,
} from './core/errors'

// Utility Functions
export { requireMacOS, isMacOS, asRecipient } from './utils/platform'
