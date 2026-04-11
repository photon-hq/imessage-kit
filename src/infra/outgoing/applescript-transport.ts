/**
 * AppleScript generation and execution.
 *
 * Stdin-based osascript execution prevents shell injection.
 * Handles special character escaping, sandbox bypass for attachments
 * outside ~/Pictures|Downloads|Documents, and file upload delays.
 */

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 30_000

type OsascriptError = Error & { killed?: boolean }

// -----------------------------------------------
// Script Execution
// -----------------------------------------------

function runViaStdin(script: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child: ChildProcess = spawn('osascript', ['-'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeoutMs,
        })

        let stdout = ''
        let stderr = ''
        let killed = false

        child.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString()
        })
        child.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString()
        })

        child.on('error', (err) => reject(err))

        child.on('close', (code, signal) => {
            if (signal === 'SIGTERM') killed = true

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

/**
 * Execute AppleScript via stdin and return stdout.
 *
 * @throws Error on execution failure or timeout
 */
export async function execAppleScript(
    script: string,
    options?: { debug?: boolean; timeout?: number }
): Promise<string> {
    const debug = options?.debug ?? false
    const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS

    if (debug) {
        console.log('[AppleScript] Executing script:\n', script)
    }

    try {
        const { stdout, stderr } = await runViaStdin(script, timeoutMs)

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

        if (('killed' in err && (err as OsascriptError).killed) || msg.includes('timeout')) {
            throw new Error(`AppleScript execution timeout (${timeoutMs}ms) - may be slow network or large file`)
        }

        if (msg.includes("Can't get buddy")) {
            throw new Error('Recipient not found or not added to iMessage contacts')
        }

        if (msg.includes("Can't send")) {
            throw new Error(
                'Send failed - please check: 1) Is Messages signed in to iMessage, ' +
                    '2) Is recipient correct, 3) Network connection'
            )
        }

        if (debug) {
            console.error('[AppleScript] Error details:', err)
        }

        throw new Error(`AppleScript execution failed: ${msg}`)
    }
}

/**
 * Check if the Messages app is currently running.
 */
export async function checkMessagesApp(): Promise<boolean> {
    try {
        await execFileAsync('pgrep', ['-x', 'Messages'], { timeout: DEFAULT_TIMEOUT_MS })
        return true
    } catch {
        return false
    }
}

// -----------------------------------------------
// String Escaping
// -----------------------------------------------

/**
 * Escape special characters for safe embedding in an AppleScript string literal.
 */
export function escapeAppleScriptString(str: string): string {
    const escapeMap: Record<string, string> = {
        '\\': '\\\\',
        '"': '\\"',
        '\n': '\\n',
        '\r': '\\r',
        '\t': '\\t',
    }

    return str.replace(/\0/g, '').replace(/[\\\n\r\t"]/g, (char) => escapeMap[char] || char)
}

// -----------------------------------------------
// Script Builder
// -----------------------------------------------

type ScriptTargetMethod = 'buddy' | 'chat'

/**
 * Build an AppleScript for sending a message via the Messages app.
 *
 * Uses the buddy method for DM recipients and the chat method for group chats.
 */
export function buildSendScript(params: {
    readonly method: ScriptTargetMethod
    readonly identifier: string
    readonly text?: string
    readonly attachmentPath?: string
}): { readonly script: string } {
    const { method, identifier, text, attachmentPath } = params
    const escapedId = escapeAppleScriptString(identifier)

    const targetSetup =
        method === 'buddy'
            ? `    set targetService to 1st service whose service type = iMessage\n    set targetBuddy to buddy "${escapedId}" of targetService`
            : `    set targetChat to chat id "${escapedId}"`

    const targetVar = method === 'buddy' ? 'targetBuddy' : 'targetChat'

    const bodyLines: string[] = []

    if (text) {
        const escapedText = escapeAppleScriptString(text)
        bodyLines.push(`    send "${escapedText}" to ${targetVar}`)
    }

    if (attachmentPath) {
        bodyLines.push(buildAttachmentSnippet(attachmentPath, targetVar))
    }

    const body = bodyLines.join('\n\n')

    return {
        script: `tell application "Messages"
${targetSetup}

${body}
end tell`,
    }
}

// -----------------------------------------------
// Internal Helpers
// -----------------------------------------------

function needsSandboxBypass(filePath: string): boolean {
    const home = homedir()
    const safeDirs = [join(home, 'Pictures'), join(home, 'Downloads'), join(home, 'Documents')]
    return !safeDirs.some((dir) => filePath.startsWith(`${dir}/`) || filePath === dir)
}

/**
 * Build a safe template and extension for mktemp.
 *
 * macOS BSD mktemp only replaces trailing X's, so the extension
 * must NOT appear inside the template. The caller appends it
 * after mktemp creates the file (via rename).
 */
function buildTempFilenameParts(filePath: string): { readonly template: string; readonly ext: string } {
    const ext = extname(filePath)
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '')
    const base = basename(filePath, ext)

    // Replace 'X' with '_' — mktemp treats X as a template placeholder
    const safeBase = base
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/X/g, '_')
        .slice(0, 60)

    const basePart = safeBase ? `${safeBase}_` : ''
    return { template: `imsg_temp_${basePart}XXXXXXXXXX`, ext: safeExt }
}

function calculateFileDelay(filePath: string): number {
    try {
        const stats = statSync(filePath)
        const sizeInMB = stats.size / (1024 * 1024)

        if (sizeInMB < 1) return 2
        if (sizeInMB < 10) return 3
        return 5
    } catch {
        return 3
    }
}

function buildAttachmentSnippet(filePath: string, targetVar: string): string {
    return needsSandboxBypass(filePath)
        ? buildSandboxBypassSnippet(filePath, targetVar)
        : buildDirectSendSnippet(filePath, targetVar)
}

function buildSandboxBypassSnippet(filePath: string, targetVar: string): string {
    const escapedFilePath = escapeAppleScriptString(filePath)
    const { template, ext } = buildTempFilenameParts(filePath)
    const escapedTemplate = escapeAppleScriptString(template)
    const escapedExt = escapeAppleScriptString(ext)
    const fileDelay = calculateFileDelay(filePath)

    // mktemp creates a file without extension (X's must be at end),
    // then we rename to append the original extension for iMessage compatibility
    return `    set picturesFolder to POSIX path of (path to pictures folder)
    set tmpBase to do shell script "mktemp " & quoted form of (picturesFolder & "${escapedTemplate}")
    set targetPath to tmpBase & "${escapedExt}"
    do shell script "mv " & quoted form of tmpBase & " " & quoted form of targetPath
    do shell script "cat " & quoted form of "${escapedFilePath}" & " > " & quoted form of targetPath & " && chmod 600 " & quoted form of targetPath & " || { rm -f " & quoted form of targetPath & "; exit 1; }"

    set theFile to (POSIX file targetPath) as alias
    send theFile to ${targetVar}
    delay ${fileDelay}`
}

function buildDirectSendSnippet(filePath: string, targetVar: string): string {
    const escapedPath = escapeAppleScriptString(filePath)
    const fileDelay = calculateFileDelay(filePath)

    return `    send POSIX file "${escapedPath}" to ${targetVar}
    delay ${fileDelay}`
}
