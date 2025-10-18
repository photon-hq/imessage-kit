/**
 * Logger Plugin
 */

import { type Plugin, definePlugin } from './core'

/**
 * Log level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Logger plugin options
 */
export interface LoggerOptions {
    /** Log level (default: info) */
    level?: LogLevel

    /** Whether to use colored output (default: true) */
    colored?: boolean

    /** Whether to show timestamps (default: false) */
    timestamp?: boolean

    /** Whether to log send operations (default: true) */
    logSend?: boolean

    /** Whether to log new messages (default: false) */
    logNewMessage?: boolean
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

const COLORS = {
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
}

const RESET = '\x1b[0m'

/**
 * Create a logger plugin
 *
 * @param options Logger configuration (optional)
 * @returns Plugin instance
 *
 * @example Basic usage
 * ```ts
 * const sdk = new IMessageSDK({
 *   plugins: [loggerPlugin()]  // Use default configuration
 * })
 * ```
 *
 * @example Custom configuration
 * ```ts
 * const sdk = new IMessageSDK({
 *   plugins: [
 *     loggerPlugin({
 *       level: 'info',        // Only show info and above
 *       colored: true,        // Colored output
 *       timestamp: true,      // Show timestamps
 *       logSend: true,        // Log send operations
 *       logNewMessage: true   // Log new messages
 *     })
 *   ]
 * })
 * ```
 *
 * @example Production configuration
 * ```ts
 * const sdk = new IMessageSDK({
 *   plugins: [
 *     loggerPlugin({
 *       level: 'warn',        // Only show warnings and errors
 *       colored: false,       // Plain text output
 *       logSend: false        // Don't log send operations
 *     })
 *   ]
 * })
 * ```
 */
export const loggerPlugin = (options: LoggerOptions = {}): Plugin => {
    const { level = 'info', colored = true, timestamp = false, logSend = true, logNewMessage = false } = options

    const log = (logLevel: LogLevel, message: string, data?: unknown) => {
        if (LEVELS[logLevel] < LEVELS[level]) return

        const time = timestamp ? new Date().toLocaleTimeString('en-US') : ''
        const tag = logLevel.toUpperCase().padEnd(5)
        const color = colored ? COLORS[logLevel] : ''
        const reset = colored ? RESET : ''

        const prefix = time ? `${time} ${color}[${tag}]${reset}` : `${color}[${tag}]${reset}`

        const output = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`

        console.log(output)
    }

    return definePlugin({
        name: 'logger',
        version: '1.0.0',
        description: 'Logger plugin',

        onInit: () => {
            log('info', 'SDK initialized')
        },

        onBeforeSend: (to, content) => {
            if (!logSend) return

            const preview = content.text?.substring(0, 30) || '(no text)'
            const attachCount = content.attachments?.length || 0
            const attachInfo = attachCount ? ` + ${attachCount} attachment(s)` : ''

            log('info', `[SEND] Sending to ${to}: ${preview}${attachInfo}`)
        },

        onAfterSend: (to) => {
            if (logSend) {
                log('info', `[OK] Sent successfully -> ${to}`)
            }
        },

        onNewMessage: (message) => {
            if (!logNewMessage) return

            const preview = message.text?.substring(0, 40) || '(no text)'
            const attachCount = message.attachments.length
            const attachInfo = attachCount ? ` [${attachCount}]` : ''

            log('info', `[MSG] New message from ${message.sender}: ${preview}${attachInfo}`)
        },

        onError: (error, context) => {
            const contextInfo = context || 'Error'
            log('error', `[ERROR] ${contextInfo}: ${error.message}`)
        },

        onDestroy: () => {
            log('info', '[CLOSE] SDK destroyed')
        },
    })
}
