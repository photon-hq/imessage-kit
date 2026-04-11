/**
 * Public API barrel.
 *
 * Every symbol importable from '@photon-ai/imessage-kit' is re-exported here.
 * Internal modules (infra internals, domain resolve functions) are NOT exposed.
 */

// -----------------------------------------------
// SDK
// -----------------------------------------------

export type {
    SendBatchItem,
    SendBatchItemResult,
    SendBatchOptions,
    SendBatchResult,
    WatcherEvents,
} from './sdk'
export { IMessageSDK } from './sdk'

// -----------------------------------------------
// Config
// -----------------------------------------------

export { BOUNDS, LIMITS } from './config'
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
export { isURL, validateRecipient } from './domain/validate'

// -----------------------------------------------
// Domain — errors
// -----------------------------------------------

export type { ErrorCode } from './domain/errors'
export {
    ConfigError,
    DatabaseError,
    IMessageError,
    PlatformError,
    SendError,
    toError,
    toErrorMessage,
} from './domain/errors'

// -----------------------------------------------
// Application
// -----------------------------------------------

export type { ChainResult } from './application/message-chain'
export { MessageChain } from './application/message-chain'
export type { DispatchEvents, MessageCallback } from './application/message-dispatcher'
export { MessageDispatcher } from './application/message-dispatcher'
export type {
    OnceTask,
    RecurrenceInterval,
    RecurringOptions,
    RecurringTask,
    ScheduledTask,
    ScheduleOptions,
    SchedulerEvents,
    SchedulerOptions,
    TaskStatus,
} from './application/message-scheduler'
export { MessageScheduler } from './application/message-scheduler'
export { parseAtExpression, parseDuration } from './application/reminder-time'
export type { Reminder, ReminderOptions } from './application/reminders'
export { Reminders } from './application/reminders'
export type { SendPort } from './application/send-port'
export type { SendContent, SendRequest, SendResult } from './types/send'

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
    NewMessageContext,
    Plugin,
    PluginErrorContext,
    PluginHooks,
} from './types/plugin'

// -----------------------------------------------
// Infra — public utilities
// -----------------------------------------------

export { getDefaultDatabasePath, requireMacOS } from './infra/platform'
export type { LoggerOptions, LogLevel } from './infra/plugin/logger'
export { loggerPlugin } from './infra/plugin/logger'
export { definePlugin } from './infra/plugin/manager'

// -----------------------------------------------
// Infra — attachment file helpers
// -----------------------------------------------

export type { AttachmentFileInfo } from './infra/attachments'
export {
    attachmentExists,
    copyAttachmentFile,
    getAttachmentExtension,
    getAttachmentFileInfo,
    getAttachmentSize,
    isAudioAttachment,
    isImageAttachment,
    isVideoAttachment,
    readAttachmentBytes,
} from './infra/attachments'
