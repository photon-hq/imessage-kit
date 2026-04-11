/**
 * Temporary file lifecycle management.
 *
 * Automatic cleanup of imsg_temp_* files in ~/Pictures.
 * Multi-instance safe: destroy() only removes expired files,
 * preventing one SDK instance from deleting another's in-flight files.
 */

import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TEMP_FILE_PREFIX = 'imsg_temp_'
const TEMP_DIR = join(homedir(), 'Pictures')

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

/** Manages lifecycle of imsg_temp_* files in ~/Pictures. */
export class TempFileManager {
    private readonly config: Required<TempFileManagerConfig>
    private cleanupTimer: NodeJS.Timeout | null = null
    private destroyPromise: Promise<void> | null = null
    private isDestroying = false
    private isDestroyed = false

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
        if (this.isDestroying) {
            throw new Error('TempFileManager is destroying, cannot start')
        }

        if (this.isDestroyed) {
            throw new Error('TempFileManager is destroyed, cannot start')
        }

        if (this.cleanupTimer) return

        this.cleanup().catch((error) => {
            if (this.config.debug) {
                console.error('[TempFileManager] Startup cleanup failed:', error)
            }
        })

        this.cleanupTimer = setInterval(() => {
            this.cleanup().catch((error) => {
                if (this.config.debug) {
                    console.error('[TempFileManager] Periodic cleanup failed:', error)
                }
            })
        }, this.config.cleanupInterval)

        this.cleanupTimer.unref()

        if (this.config.debug) {
            const intervalSec = this.config.cleanupInterval / 1_000
            const maxAgeSec = this.config.maxAge / 1_000
            console.log(`[TempFileManager] Started, interval: ${intervalSec}s, maxAge: ${maxAgeSec}s`)
        }
    }

    /** Stop the periodic cleanup timer. */
    stop(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer)
            this.cleanupTimer = null
        }
    }

    /** Stop the timer and remove expired files. */
    async destroy(): Promise<void> {
        if (this.isDestroyed) return

        if (this.destroyPromise) {
            await this.destroyPromise
            return
        }

        this.destroyPromise = (async () => {
            this.isDestroying = true
            this.stop()

            try {
                await this.removeFiles({ ignoreAge: false })
            } finally {
                this.isDestroyed = true
                this.isDestroying = false

                if (this.config.debug) {
                    console.log('[TempFileManager] Destroyed')
                }
            }
        })()

        try {
            await this.destroyPromise
        } finally {
            this.destroyPromise = null
        }
    }

    // -----------------------------------------------
    // Cleanup
    // -----------------------------------------------

    /** Remove expired temp files. */
    async cleanup(): Promise<{ removed: number; errors: number }> {
        if (this.isDestroyed) return { removed: 0, errors: 0 }
        return this.removeFiles({ ignoreAge: false })
    }

    /** Remove all temp files regardless of age. */
    async cleanupAll(): Promise<{ removed: number; errors: number }> {
        if (this.isDestroyed) return { removed: 0, errors: 0 }
        return this.removeFiles({ ignoreAge: true })
    }

    // -----------------------------------------------
    // Stats
    // -----------------------------------------------

    /** Return current temp file count, running state, and config. */
    getStats(): {
        readonly currentFiles: number
        readonly isRunning: boolean
        readonly config: Required<TempFileManagerConfig>
    } {
        let currentFiles = 0

        try {
            if (existsSync(TEMP_DIR)) {
                const files = readdirSync(TEMP_DIR)
                currentFiles = files.filter((f) => f.startsWith(TEMP_FILE_PREFIX)).length
            }
        } catch {
            // Return 0 when scan fails
        }

        return {
            currentFiles,
            isRunning: this.cleanupTimer !== null,
            config: { ...this.config },
        }
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private async removeFiles(options: { ignoreAge: boolean }): Promise<{ removed: number; errors: number }> {
        let removed = 0
        let errors = 0
        const now = Date.now()

        try {
            if (!existsSync(TEMP_DIR)) return { removed, errors }

            const files = readdirSync(TEMP_DIR)

            for (const file of files) {
                if (!file.startsWith(TEMP_FILE_PREFIX)) continue

                const filePath = join(TEMP_DIR, file)

                try {
                    const stats = lstatSync(filePath)

                    if (!stats.isFile()) {
                        if (this.config.debug) {
                            console.log(`[TempFileManager] Skipping non-regular file: ${file}`)
                        }
                        continue
                    }

                    if (!options.ignoreAge) {
                        const fileAge = now - stats.mtimeMs
                        if (fileAge <= this.config.maxAge) continue
                    }

                    unlinkSync(filePath)
                    removed++

                    if (this.config.debug) {
                        console.log(`[TempFileManager] Removed: ${file}`)
                    }
                } catch (error) {
                    errors++

                    if (this.config.debug) {
                        console.error(`[TempFileManager] Failed to remove: ${file}`, error)
                    }
                }
            }

            if (this.config.debug && (removed > 0 || errors > 0)) {
                console.log(`[TempFileManager] Done: removed ${removed}, errors ${errors}`)
            }
        } catch (error) {
            if (this.config.debug) {
                console.error('[TempFileManager] Cleanup process error:', error)
            }
        }

        return { removed, errors }
    }
}
