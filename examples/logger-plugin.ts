/**
 * Example: configurable logger plugin.
 *
 * Copy this into your app and adapt it to your logger of choice
 * (pino, winston, console, etc.). Not part of the SDK core —
 * the SDK emits events through plugin hooks and `debug: true`;
 * application-layer logging is the user's responsibility.
 *
 * When copying this file into your own project, change the import below
 * from the in-repo path to the published package name:
 *
 *   import type { Plugin } from '@photon-ai/imessage-kit'
 */

import type { Plugin } from '../src/types/plugin'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Severity threshold for log filtering. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Configuration for the logger plugin. */
export interface LoggerOptions {
    readonly level?: LogLevel
    readonly colors?: boolean
    readonly timestamps?: boolean
    readonly logSend?: boolean
    readonly logNewMessage?: boolean
}

// -----------------------------------------------
// Constants
// -----------------------------------------------

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const COLORS: Record<LogLevel, string> = {
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
}

const RESET = '\x1b[0m'

// -----------------------------------------------
// Logger Plugin
// -----------------------------------------------

/** Create a configurable logger plugin. */
export const loggerPlugin = (options: LoggerOptions = {}): Plugin => {
    const { level = 'info', colors = true, timestamps = false, logSend = true, logNewMessage = false } = options

    const log = (logLevel: LogLevel, message: string, data?: unknown) => {
        if (LEVELS[logLevel] < LEVELS[level]) return

        const time = timestamps ? new Date().toISOString() : ''
        const tag = logLevel.toUpperCase().padEnd(5)
        const color = colors ? COLORS[logLevel] : ''
        const reset = colors ? RESET : ''

        const prefix = time ? `${time} ${color}[${tag}]${reset}` : `${color}[${tag}]${reset}`
        const output = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`

        if (logLevel === 'error') {
            console.error(output)
        } else if (logLevel === 'warn') {
            console.warn(output)
        } else {
            console.log(output)
        }
    }

    return {
        name: 'logger',
        version: '1.0.0',
        description: 'Built-in logger plugin',

        onInit: () => {
            log('info', 'SDK initialized')
        },

        onBeforeSend: ({ request }) => {
            if (!logSend) return

            const preview = request.text?.substring(0, 30) || '(no text)'
            const attachCount = request.attachments?.length || 0
            const attachInfo = attachCount ? ` + ${attachCount} attachment(s)` : ''

            log('info', `[SEND] Sending to ${request.to}: ${preview}${attachInfo}`)
        },

        onFromMe: ({ message }) => {
            if (!logSend) return

            // Fires for every from-me row the watcher observes, including
            // SDK sends, sends from other Apple clients, and Messages.app UI.
            // Authoritative source of "my send landed in chat.db".
            log('info', `[OK] Landed (${message.id})`)
        },

        onIncomingMessage: ({ message }) => {
            if (!logNewMessage) return

            const preview = message.text?.substring(0, 40) || '(no text)'
            const attachCount = message.attachments.length
            const attachInfo = attachCount ? ` [${attachCount}]` : ''
            const source = message.participant ?? (message.isFromMe ? 'me' : 'unknown')

            log('info', `[MSG] New message from ${source}: ${preview}${attachInfo}`)
        },

        onError: ({ error, context }) => {
            log('error', `[ERROR] ${context || 'Error'}: ${error.message}`)
        },

        onDestroy: () => {
            log('info', '[CLOSE] SDK destroyed')
        },
    }
}
