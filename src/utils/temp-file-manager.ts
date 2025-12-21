/**
 * Temporary file manager
 */

import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Temp file prefix */
const TEMP_FILE_PREFIX = 'imsg_temp_'

/** Temp file directory */
const TEMP_DIR = join(homedir(), 'Pictures')

/** Default cleanup configuration */
const DEFAULT_CONFIG = {
    /** File retention time (milliseconds), default 10 minutes */
    maxAge: 10 * 60 * 1000,
    /** Cleanup interval (milliseconds), default 5 minutes */
    cleanupInterval: 5 * 60 * 1000,
}

/**
 * Temp file manager configuration
 */
export interface TempFileManagerConfig {
    /** File retention time (milliseconds) */
    maxAge?: number
    /** Cleanup interval (milliseconds) */
    cleanupInterval?: number
    /** Whether to enable debug logs */
    debug?: boolean
}

/**
 * Temp file manager class
 */
export class TempFileManager {
    private readonly config: Required<TempFileManagerConfig>
    private cleanupTimer: NodeJS.Timeout | null = null
    private isDestroyed = false

    constructor(config: TempFileManagerConfig = {}) {
        this.config = {
            maxAge: config.maxAge ?? DEFAULT_CONFIG.maxAge,
            cleanupInterval: config.cleanupInterval ?? DEFAULT_CONFIG.cleanupInterval,
            debug: config.debug ?? false,
        }
    }

    /**
     * Start cleanup task
     */
    start(): void {
        if (this.isDestroyed) {
            throw new Error('TempFileManager is destroyed, cannot start')
        }

        /** Clean up immediately (clean up leftover files) */
        this.cleanup().catch((error) => {
            if (this.config.debug) {
                console.error('[TempFileManager] Startup cleanup failed:', error)
            }
        })

        /** Periodic cleanup */
        this.cleanupTimer = setInterval(() => {
            this.cleanup().catch((error) => {
                if (this.config.debug) {
                    console.error('[TempFileManager] Periodic cleanup failed:', error)
                }
            })
        }, this.config.cleanupInterval)

        /** Prevent timer from blocking process exit */
        this.cleanupTimer.unref()

        if (this.config.debug) {
            const intervalSec = this.config.cleanupInterval / 1000
            const maxAgeSec = this.config.maxAge / 1000
            console.log(
                `[TempFileManager] Started, cleanup interval: ${intervalSec}s, max file retention: ${maxAgeSec}s`
            )
        }
    }

    /**
     * Clean up old temporary files
     *
     * By scanning ~/Pictures directory,
     * auto-discover and clean all imsg_temp_* files exceeding retention time
     */
    async cleanup(): Promise<{ removed: number; errors: number }> {
        if (this.isDestroyed) {
            return { removed: 0, errors: 0 }
        }

        let removed = 0
        let errors = 0
        const now = Date.now()

        try {
            if (existsSync(TEMP_DIR)) {
                const files = readdirSync(TEMP_DIR)

                for (const file of files) {
                    if (!file.startsWith(TEMP_FILE_PREFIX)) {
                        continue
                    }

                    const filePath = join(TEMP_DIR, file)

                    try {
                        const stats = lstatSync(filePath)

                        // Security: Skip symlinks and non-regular files (prevent symlink attacks)
                        if (!stats.isFile() || stats.isSymbolicLink()) {
                            if (this.config.debug) {
                                console.log(`[TempFileManager] Skipping non-regular file: ${file}`)
                            }
                            continue
                        }

                        const fileAge = now - stats.mtimeMs

                        /** Delete files exceeding retention time */
                        if (fileAge > this.config.maxAge) {
                            unlinkSync(filePath)
                            removed++

                            if (this.config.debug) {
                                const ageMinutes = (fileAge / 60000).toFixed(1)
                                console.log(`[TempFileManager] Removed old file: ${file} (${ageMinutes} minutes ago)`)
                            }
                        }
                    } catch (error) {
                        errors++
                        if (this.config.debug) {
                            console.error(`[TempFileManager] Failed to remove file: ${file}`, error)
                        }
                    }
                }
            }

            if (this.config.debug && (removed > 0 || errors > 0)) {
                console.log(`[TempFileManager] Cleanup complete: removed ${removed} files, ${errors} errors`)
            }
        } catch (error) {
            if (this.config.debug) {
                console.error('[TempFileManager] Cleanup process error:', error)
            }
        }

        return { removed, errors }
    }

    /**
     * Clean up all temporary files (regardless of time)
     *
     * Called when SDK is destroyed, immediately clean all imsg_temp_* files
     */
    async cleanupAll(): Promise<{ removed: number; errors: number }> {
        if (this.isDestroyed) {
            return { removed: 0, errors: 0 }
        }

        let removed = 0
        let errors = 0

        try {
            if (existsSync(TEMP_DIR)) {
                const files = readdirSync(TEMP_DIR)

                for (const file of files) {
                    if (!file.startsWith(TEMP_FILE_PREFIX)) {
                        continue
                    }

                    const filePath = join(TEMP_DIR, file)

                    try {
                        const stats = lstatSync(filePath)

                        // Security: Skip symlinks and non-regular files
                        if (!stats.isFile() || stats.isSymbolicLink()) {
                            if (this.config.debug) {
                                console.log(`[TempFileManager] Skipping non-regular file: ${file}`)
                            }
                            continue
                        }

                        unlinkSync(filePath)
                        removed++

                        if (this.config.debug) {
                            console.log(`[TempFileManager] Removed file: ${file}`)
                        }
                    } catch (error) {
                        errors++
                        if (this.config.debug) {
                            console.error(`[TempFileManager] Failed to remove file: ${file}`, error)
                        }
                    }
                }
            }

            if (this.config.debug) {
                console.log(`[TempFileManager] Cleanup all files complete: removed ${removed}, ${errors} errors`)
            }
        } catch (error) {
            if (this.config.debug) {
                console.error('[TempFileManager] Cleanup all files error:', error)
            }
        }

        return { removed, errors }
    }

    /**
     * Stop cleanup task
     */
    stop(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer)
            this.cleanupTimer = null
        }
    }

    /**
     * Destroy manager (stop cleanup and clean all files)
     */
    async destroy(): Promise<void> {
        if (this.isDestroyed) {
            return
        }

        this.isDestroyed = true
        this.stop()

        // Clean up all temp files
        await this.cleanupAll()

        if (this.config.debug) {
            console.log('[TempFileManager] Destroyed')
        }
    }

    /**
     * Get statistics
     */
    getStats(): {
        currentFiles: number
        isRunning: boolean
        config: Required<TempFileManagerConfig>
    } {
        let currentFiles = 0

        try {
            if (existsSync(TEMP_DIR)) {
                const files = readdirSync(TEMP_DIR)
                currentFiles = files.filter((f) => f.startsWith(TEMP_FILE_PREFIX)).length
            }
        } catch {
            /** Return 0 when scan fails */
        }

        return {
            currentFiles,
            isRunning: this.cleanupTimer !== null,
            config: { ...this.config },
        }
    }
}
