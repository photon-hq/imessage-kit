/**
 * Platform detection.
 *
 * macOS requirement, default paths, Darwin version, and service prefix.
 */

import { homedir, release } from 'node:os'
import { join } from 'node:path'
import type { ChatServicePrefix } from '../domain/chat-id'
import { PlatformError, toError } from '../domain/errors'

// -----------------------------------------------
// macOS requirement
// -----------------------------------------------

/** Assert running on macOS. Throws PlatformError otherwise. */
export function requireMacOS(): void {
    if (process.platform !== 'darwin') {
        throw PlatformError('Only macOS is supported')
    }
}

// -----------------------------------------------
// Default paths
// -----------------------------------------------

/** Default path to the iMessage database. */
export function getDefaultDatabasePath(): string {
    let home: string
    try {
        home = homedir()
    } catch (cause) {
        throw PlatformError('Unable to resolve user home directory', toError(cause))
    }

    return join(home, 'Library', 'Messages', 'chat.db')
}

// -----------------------------------------------
// Darwin version
// -----------------------------------------------

/** Parse the Darwin major version number from os.release(). */
export function getDarwinMajorVersion(osRelease: string = release()): number {
    const value = Number.parseInt(osRelease.split('.')[0] ?? '', 10)
    return Number.isFinite(value) ? value : 0
}

// -----------------------------------------------
// Service prefix
// -----------------------------------------------

/** Map Darwin major version to the ChatId service prefix used by Messages.app. */
export function detectChatServicePrefix(darwinMajor: number = getDarwinMajorVersion()): ChatServicePrefix {
    return darwinMajor >= 25 ? 'any' : 'iMessage'
}
