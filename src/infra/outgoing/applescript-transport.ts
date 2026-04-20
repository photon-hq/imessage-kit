/**
 * AppleScript execution and Messages.app liveness probe.
 *
 * Runtime-facing subprocess wrappers: stdin-based osascript execution
 * prevents shell injection; `MessagesAppProbe` caches a pgrep result so
 * high-throughput send loops don't fork a probe per send.
 */

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 30_000

/** Ceiling for `pgrep`-style process probes. pgrep returns in sub-ms on a healthy system. */
const PROBE_TIMEOUT_MS = 2_000

type OsascriptError = Error & { killed?: boolean }

// -----------------------------------------------
// Script Execution
// -----------------------------------------------

/**
 * Execute AppleScript via stdin and return stdout.
 *
 * @throws Error on execution failure or timeout
 */
export async function execAppleScript(
    script: string,
    options?: { debug?: boolean; timeout?: number; signal?: AbortSignal }
): Promise<string> {
    const debug = options?.debug ?? false
    const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS

    if (debug) {
        console.log('[AppleScript] Executing script:\n', script)
    }

    try {
        const { stdout, stderr } = await runViaStdin(script, timeoutMs, options?.signal)

        if (stderr && debug) {
            console.warn('[AppleScript] Warning:', stderr)
        }

        if (debug) {
            console.log('[AppleScript] Success:', stdout || '(no output)')
        }

        return stdout.trim()
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error))
        const msg = err.message

        // Distinguish caller-initiated abort from genuine timeout: both
        // kill the child with SIGTERM (setting `killed`), but the abort
        // path is expected shutdown, not a slow-network symptom.
        if (options?.signal?.aborted) {
            throw new Error('AppleScript execution aborted', { cause: err })
        }

        if ('killed' in err && (err as OsascriptError).killed) {
            throw new Error(`AppleScript execution timeout (${timeoutMs}ms) - may be slow network or large file`, {
                cause: err,
            })
        }

        // Fragile heuristics: Messages.app stderr wording is not a stable
        // API; these `includes` checks only remap the common cases to
        // friendlier messages. If Apple changes the wording the generic
        // "AppleScript execution failed" branch still runs, so the user
        // still sees the underlying error.
        if (msg.includes("Can't get buddy")) {
            throw new Error('Recipient not found or not added to iMessage contacts', { cause: err })
        }

        if (msg.includes("Can't send")) {
            throw new Error(
                'Send failed - please check: 1) Is Messages signed in to iMessage, ' +
                    '2) Is recipient correct, 3) Network connection',
                { cause: err }
            )
        }

        if (debug) {
            console.error('[AppleScript] Error details:', err)
        }

        throw new Error(`AppleScript execution failed: ${msg}`, { cause: err })
    }
}

function runViaStdin(
    script: string,
    timeoutMs: number,
    signal?: AbortSignal
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('AppleScript execution aborted'))
            return
        }

        const child: ChildProcess = spawn('osascript', ['-'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeoutMs,
        })

        let stdout = ''
        let stderr = ''
        let killed = false

        const onAbort = () => {
            killed = true
            child.kill('SIGTERM')
        }
        signal?.addEventListener('abort', onAbort, { once: true })

        child.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString()
        })
        child.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString()
        })

        // If osascript dies before consuming stdin (e.g. killed by the
        // `timeout` option or by our SIGTERM), writes emit EPIPE on the
        // stdin stream. Without a listener Node surfaces it as an
        // unhandled 'error' event. Swallow it — the real failure is
        // reported by the 'close' handler below.
        child.stdin?.on('error', () => {})

        child.on('error', (err) => {
            signal?.removeEventListener('abort', onAbort)
            reject(err)
        })

        child.on('close', (code, sig) => {
            signal?.removeEventListener('abort', onAbort)
            if (sig === 'SIGTERM') killed = true

            if (code === 0) {
                resolve({ stdout, stderr })
            } else {
                const err = new Error(stderr || `osascript exited with code ${code}`) as OsascriptError
                err.killed = killed
                reject(err)
            }
        })

        child.stdin?.write(script)
        child.stdin?.end()
    })
}

// -----------------------------------------------
// Messages.app probe
// -----------------------------------------------

/**
 * Probe "Messages.app running?" with a short-lived cache.
 *
 * Used by Sender to avoid spawning a pgrep per send in high-throughput loops.
 * Cache is per-instance so SDK instances don't share state.
 */
export class MessagesAppProbe {
    private static readonly CACHE_TTL_MS = 2_000
    private cache: { readonly value: boolean; readonly expires: number } | null = null

    async isRunning(): Promise<boolean> {
        const now = Date.now()
        if (this.cache && this.cache.expires > now) return this.cache.value

        let value: boolean
        try {
            await execFileAsync('pgrep', ['-x', 'Messages'], { timeout: PROBE_TIMEOUT_MS })
            value = true
        } catch {
            value = false
        }

        this.cache = { value, expires: now + MessagesAppProbe.CACHE_TTL_MS }
        return value
    }
}
