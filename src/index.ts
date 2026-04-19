/**
 * Public API barrel.
 *
 * Every symbol importable from '@photon-ai/imessage-kit' is re-exported here.
 * Internal modules (infra internals, domain resolve functions) are NOT exposed.
 */

// -----------------------------------------------
// SDK
// -----------------------------------------------

export type { DispatchEvents } from './application/message-dispatcher'
export { IMessageSDK } from './sdk'

// -----------------------------------------------
// Config
// -----------------------------------------------

export { BOUNDS } from './sdk-bounds'
export type { IMessageConfig } from './types/config'

// -----------------------------------------------
// Domain — types
// -----------------------------------------------

export type { Attachment, TransferStatus } from './domain/attachment'
export type { Chat, ChatKind } from './domain/chat'
export type {
    ExpireStatus,
    Message,
    MessageKind,
    ScheduleKind,
    ScheduleStatus,
    ShareActivity,
    ShareDirection,
} from './domain/message'
export type { Reaction, ReactionKind, ReactionTextRange } from './domain/reaction'
export type { Service } from './domain/service'

// -----------------------------------------------
// Domain — values
// -----------------------------------------------

export type { ChatServicePrefix } from './domain/chat-id'
export { ChatId } from './domain/chat-id'
export type { MessageTarget } from './domain/routing'
export { resolveTarget } from './domain/routing'

// -----------------------------------------------
// Domain — errors
// -----------------------------------------------

export type { ErrorCode } from './domain/errors'
export { ConfigError, DatabaseError, IMessageError, PlatformError, SendError } from './domain/errors'

// -----------------------------------------------
// Application
// -----------------------------------------------

export type { MessageCallback } from './application/message-dispatcher'
export type { SendPort } from './application/send-port'
export type { SendRequest } from './types/send'

// -----------------------------------------------
// Query types
// -----------------------------------------------

export type { ChatQuery, MessageQuery } from './types/query'

// -----------------------------------------------
// Plugin types
// -----------------------------------------------

export type {
    AfterChatQueryContext,
    AfterMessageQueryContext,
    AfterSendContext,
    BeforeChatQueryContext,
    BeforeMessageQueryContext,
    BeforeSendContext,
    MessageContext,
    Plugin,
    PluginErrorContext,
    PluginHooks,
} from './types/plugin'

// -----------------------------------------------
// Infra — public utilities
// -----------------------------------------------

export { getDefaultDatabasePath, requireMacOS } from './infra/platform'
export { definePlugin } from './infra/plugin'

// -----------------------------------------------
// Infra — attachment file helpers
// -----------------------------------------------

export {
    attachmentExists,
    getAttachmentExtension,
    isAudioAttachment,
    isImageAttachment,
    isVideoAttachment,
} from './infra/attachments'
