/**
 * Plugin type definitions.
 *
 * Defines the contract that user-authored plugins implement.
 */

import type { Chat } from '../domain/chat'
import type { Message } from '../domain/message'
import type { ChatQuery, MessageQuery } from './query'
import type { SendRequest, SendResult } from './send'

// -----------------------------------------------
// Hook contexts
// -----------------------------------------------

export interface BeforeMessageQueryContext {
    readonly query: MessageQuery
}

export interface AfterMessageQueryContext {
    readonly query: MessageQuery
    readonly messages: readonly Message[]
}

export interface BeforeChatQueryContext {
    readonly query: ChatQuery
}

export interface AfterChatQueryContext {
    readonly query: ChatQuery
    readonly chats: readonly Chat[]
}

export interface BeforeSendContext {
    readonly request: SendRequest
}

export interface AfterSendContext {
    readonly request: SendRequest
    readonly result: SendResult
}

export interface NewMessageContext {
    readonly message: Message
}

export interface PluginErrorContext {
    readonly error: Error
    readonly context?: string
}

// -----------------------------------------------
// Plugin hooks
// -----------------------------------------------

export interface PluginHooks {
    onInit?: () => void | Promise<void>
    onBeforeMessageQuery?: (ctx: BeforeMessageQueryContext) => void | Promise<void>
    onAfterMessageQuery?: (ctx: AfterMessageQueryContext) => void | Promise<void>
    onBeforeChatQuery?: (ctx: BeforeChatQueryContext) => void | Promise<void>
    onAfterChatQuery?: (ctx: AfterChatQueryContext) => void | Promise<void>
    onBeforeSend?: (ctx: BeforeSendContext) => void | Promise<void>
    onAfterSend?: (ctx: AfterSendContext) => void | Promise<void>
    onNewMessage?: (ctx: NewMessageContext) => void | Promise<void>
    onError?: (ctx: PluginErrorContext) => void | Promise<void>
    onDestroy?: () => void | Promise<void>
}

// -----------------------------------------------
// Plugin
// -----------------------------------------------

export interface Plugin extends PluginHooks {
    readonly name: string
    readonly version?: string
    readonly description?: string
    readonly order?: 'pre' | 'post'
}
