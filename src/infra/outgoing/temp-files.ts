/**
 * Temporary file lifecycle management.
 *
 * The send pipeline copies attachments into `~/Pictures/imsg_temp_*`
 * directories (see `applescript-builder.ts`) so Messages.app's sandbox
 * can read them — this manager sweeps those entries when they exceed
 * `maxAge`.
 *
 * Multi-instance safe: cleanup filters by mtime, so one SDK instance
 * never deletes another's in-flight attachments.
 */

import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ConfigError } from '../../domain/errors'
import { MESSAGES_APP_TEMP_FILE_PREFIX, MESSAGES_APP_TEMP_WRITE_DIR } from '../../domain/messages-app'

const TEMP_DIR = join(homedir(), MESSAGES_APP_TEMP_WRITE_DIR)

// -----------------------------------------------
// Config
// -----------------------------------------------

/** Configuration for the TempFileManager. */
export interface TempFileManagerConfig {
    /** File retention time in ms (default: 10 minutes). */
    readonly maxAge?: number
    /** Cleanup interval in ms (default: 5 minutes). */
    readonly cleanupInterval?: number
    /** Enable debug logs. */
    readonly debug?: boolean
}

const DEFAULTS = {
    maxAge: 10 * 60 * 1_000,
    cleanupInterval: 5 * 60 * 1_000,
} as const

// -----------------------------------------------
// TempFileManager
// -----------------------------------------------

/** Manages lifecycle of `imsg_temp_*` entries in ~/Pictures. */
export class TempFileManager {
    private readonly config: Required<TempFileManagerConfig>
    private cleanupTimer: NodeJS.Timeout | null = null
    private destroyPromise: Promise<void> | null = null

    constructor(config: TempFileManagerConfig = {}) {
        this.config = {
            maxAge: config.maxAge ?? DEFAULTS.maxAge,
            cleanupInterval: config.cleanupInterval ?? DEFAULTS.cleanupInterval,
            debug: config.debug ?? false,
        }
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    /** Start the periodic cleanup timer. */
    start(): void {
        if (this.destroyPromise) {
            throw ConfigError('TempFileManager is destroyed or destroying, cannot start')
        }

        if (this.cleanupTimer) return

        this.removeExpiredFiles()

        this.cleanupTimer = setInterval(() => {
            if (this.destroyPromise) return
            this.removeExpiredFiles()
        }, this.config.cleanupInterval)

        // Allow process exit if this timer is the only remaining event.
        this.cleanupTimer.unref()

        if (this.config.debug) {
            const intervalSec = this.config.cleanupInterval / 1_000
            const maxAgeSec = this.config.maxAge / 1_000
            console.log(`[TempFileManager] Started, interval: ${intervalSec}s, maxAge: ${maxAgeSec}s`)
        }
    }

    /** Stop the timer and remove expired files. */
    async destroy(): Promise<void> {
        if (this.destroyPromise) return this.destroyPromise
        this.destroyPromise = this.doDestroy()
        return this.destroyPromise
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private async doDestroy(): Promise<void> {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer)
            this.cleanupTimer = null
        }

        this.removeExpiredFiles()

        if (this.config.debug) {
            console.log('[TempFileManager] Destroyed')
        }
    }

    private removeExpiredFiles(): void {
        const now = Date.now()

        try {
            if (!existsSync(TEMP_DIR)) return

            const entries = readdirSync(TEMP_DIR)

            for (const entry of entries) {
                if (!entry.startsWith(MESSAGES_APP_TEMP_FILE_PREFIX)) continue

                const entryPath = join(TEMP_DIR, entry)

                try {
                    const stats = lstatSync(entryPath)
                    const age = now - stats.mtimeMs
                    if (age <= this.config.maxAge) continue

                    // `recursive: true` handles both the current directory
                    // layout and any legacy single-file temp entries;
                    // `force: true` tolerates races (e.g. concurrent sweep).
                    rmSync(entryPath, { recursive: true, force: true })

                    if (this.config.debug) {
                        console.log(`[TempFileManager] Removed: ${entry}`)
                    }
                } catch (error) {
                    if (this.config.debug) {
                        console.error(`[TempFileManager] Failed to remove: ${entry}`, error)
                    }
                }
            }
        } catch (error) {
            if (this.config.debug) {
                console.error('[TempFileManager] Cleanup process error:', error)
            }
        }
    }
}
