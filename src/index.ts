/**
 * @photon-ai/imessage-kit - macOS iMessage 开发工具包
 *
 * @example
 * ```ts
 * import { IMessageSDK, type IMessage } from '@photon-ai/imessage-kit'
 *
 * const config: IMessage.Config = {
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
 *   onNewMessage: async (msg) => {
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

export namespace IMessage {
    export type Config = import('./types/config').IMessageConfig
    export type ResolvedConfig = import('./types/config').ResolvedConfig
    export type WebhookConfig = import('./types/config').WebhookConfig
    export type WatcherConfig = import('./types/config').WatcherConfig
    export type RetryConfig = import('./types/config').RetryConfig
    export type TempFileConfig = import('./types/config').TempFileConfig

    export type Message = import('./types/message').Message
    export type Attachment = import('./types/message').Attachment
    export type ServiceType = import('./types/message').ServiceType
    export type MessageFilter = import('./types/message').MessageFilter
    export type SendResult = import('./types/message').SendResult

    export type Recipient = import('./types/advanced').Recipient
    export type Predicate<T> = import('./types/advanced').Predicate<T>
    export type Mapper<T, U> = import('./types/advanced').Mapper<T, U>

    export type Plugin = import('./plugins/core').Plugin
    export type PluginHooks = import('./plugins/core').PluginHooks

    export type Error = import('./core/errors').IMessageError
    export type ErrorCode = import('./core/errors').ErrorCode
}

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
