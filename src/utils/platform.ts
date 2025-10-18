/**
 * Platform check utilities
 */

import { PlatformError } from '../core/errors'

export { asRecipient } from '../types/advanced'

/**
 * Check and require running on macOS platform
 *
 * @throws PlatformError when not macOS
 */
export const requireMacOS = (): void => {
    if (process.platform !== 'darwin') {
        throw PlatformError('Only macOS is supported')
    }
}

/**
 * Check if current system is macOS
 *
 * @returns true if macOS
 */
export const isMacOS = (): boolean => {
    return process.platform === 'darwin'
}

/**
 * Get default path of iMessage database
 *
 * @returns Full path to database file
 * @throws Error when HOME environment variable is not set
 */
export const getDefaultDatabasePath = (): string => {
    const home = process.env.HOME

    if (!home) {
        throw new Error('HOME environment variable is not set')
    }

    return `${home}/Library/Messages/chat.db`
}
