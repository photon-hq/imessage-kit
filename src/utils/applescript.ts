/**
 * AppleScript Utilities
 *
 * Generate and execute Messages app control scripts
 * Wait for script completion (30s timeout)
 * Special character escaping (prevent injection)
 * Sandbox bypass (auto-copy to ~/Pictures)
 * Upload wait (ensure iMessage uploads to iCloud)
 */

import { exec } from 'node:child_process'
import { basename, extname } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/** Default script execution timeout (can be overridden) */
const DEFAULT_SCRIPT_TIMEOUT = 30000

/**
 * Execute AppleScript
 *
 * @param script - AppleScript code
 * @param debug - Whether to output debug logs
 * @param timeoutMs - Timeout in milliseconds (default 30s)
 * @returns Script output
 * @throws Error when execution fails
 */
export const execAppleScript = async (
    script: string,
    debug = false,
    timeoutMs = DEFAULT_SCRIPT_TIMEOUT
): Promise<string> => {
    if (debug) {
        console.log('[AppleScript] Executing script:\n', script)
    }

    try {
        const escapedScript = script.replace(/'/g, "'\\''")
        const { stdout, stderr } = await execAsync(`osascript -e '${escapedScript}'`, {
            timeout: timeoutMs,
            encoding: 'utf-8',
        })

        if (stderr && debug) {
            console.warn('[AppleScript] Warning:', stderr)
        }

        if (debug) {
            console.log('[AppleScript] Success:', stdout || '(no output)')
        }

        return stdout.trim()
    } catch (error: any) {
        const errorMsg = error.message || String(error)

        if (error.killed || errorMsg.includes('timeout')) {
            const message = [
                `AppleScript execution timeout (${timeoutMs}ms)`,
                'may be slow network or large file',
            ].join(' - ')
            throw new Error(message)
        }

        if (errorMsg.includes("Can't get buddy")) {
            throw new Error('Recipient not found or not added to iMessage contacts')
        }

        if (errorMsg.includes("Can't send")) {
            const reasons = [
                '1) Is Messages signed in to iMessage',
                '2) Is recipient correct',
                '3) Network connection',
            ].join(', ')
            throw new Error(`Send failed - please check: ${reasons}`)
        }

        if (debug) {
            console.error('[AppleScript] Error details:', error)
        }

        throw new Error(`AppleScript execution failed: ${errorMsg}`)
    }
}

/**
 * Check if Messages app is running
 *
 * Uses pgrep command to find process
 *
 * @returns true if app is running
 */
export const checkMessagesApp = async (): Promise<boolean> => {
    try {
        await execAsync('pgrep -x Messages', {
            timeout: DEFAULT_SCRIPT_TIMEOUT,
        })
        return true
    } catch {
        return false
    }
}

/**
 * Check if iMessage is signed in and active
 *
 * @param debug - Whether to output debug logs
 * @returns true if likely signed in
 */
export const checkIMessageStatus = async (debug = false): Promise<boolean> => {
    try {
        const script = `
tell application "Messages"
    try
        set accountList to every account
        if (count of accountList) is 0 then
            return "no_accounts"
        end if
        
        set hasActiveAccount to false
        repeat with acct in accountList
            if enabled of acct is true then
                set hasActiveAccount to true
                exit repeat
            end if
        end repeat
        
        if hasActiveAccount then
            return "active"
        else
            return "inactive"
        end if
    on error
        return "error"
    end try
end tell
`
        const escapedScript = script.replace(/'/g, "'\\''")
        const { stdout } = await execAsync(`osascript -e '${escapedScript}'`, {
            timeout: 5000,
        })

        const result = stdout.trim()

        if (debug) {
            console.log('[iMessage Status Check]', result)
        }

        return result === 'active'
    } catch (error) {
        if (debug) {
            console.warn('[iMessage Status Check Failed]', error)
        }
        return true
    }
}

/**
 * Escape special characters in AppleScript string
 *
 * Prevent script injection and syntax errors
 *
 * @param str Original string
 * @returns Escaped string
 */
export const escapeAppleScriptString = (str: string): string => {
    /** Escape mapping table */
    const escapeMap: Record<string, string> = {
        '\\': '\\\\', // Backslash
        '"': '\\"', // Double quote
        '\n': '\\n', // Newline
        '\r': '\\r', // Carriage return
        '\t': '\\t', // Tab
    }

    return str.replace(/[\\\n\r\t"]/g, (char) => escapeMap[char] || char)
}

/**
 * Generate AppleScript for sending plain text message
 *
 * @param recipient Recipient (phone number or email)
 * @param text Message content
 * @returns AppleScript code
 */
export const generateSendTextScript = (recipient: string, text: string): string => {
    const escapedText = escapeAppleScriptString(text)
    const escapedRecipient = escapeAppleScriptString(recipient)

    return `
tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "${escapedRecipient}" of targetService
    send "${escapedText}" to targetBuddy
end tell
`.trim()
}

/**
 * Generate AppleScript for sending plain text to a chat by chatId
 *
 * @param chatId Chat identifier from Messages database
 * @param text Message content
 * @returns AppleScript code
 */
export const generateSendTextToChat = (chatId: string, text: string): string => {
    const escapedText = escapeAppleScriptString(text)
    const escapedChatId = escapeAppleScriptString(chatId)

    return `
tell application "Messages"
    set targetChat to chat id "${escapedChatId}"
    send "${escapedText}" to targetChat
end tell
`.trim()
}

/**
 * Check if file needs sandbox bypass
 */
function needsSandboxBypass(filePath: string): boolean {
    return !filePath.match(/(Pictures|Downloads|Documents)/)
}

/**
 * Build a `mktemp`-compatible filename template that preserves the original file
 * extension for better UX in Messages.
 *
 * Sanitization rules and rationale:
 * - Special characters in the basename are replaced with underscores (`_`)
 *   to produce a shell-safe template and avoid issues when passed to `mktemp`.
 * - Literal `X` characters in the basename are replaced with underscores to
 *   avoid confusion with `mktemp`'s own `X` pattern, which it interprets as
 *   a placeholder for random characters.
 * - The sanitized basename is truncated to 60 characters to keep the final
 *   path length within reasonable limits.
 *
 * The final template has the form:
 *   `imsg_temp_{basename}_XXXXXXXXXX{ext}`
 * where:
 * - `{basename}` is the sanitized, at-most-60-character basename (or omitted
 *   entirely if empty, in which case the underscore is also omitted), and
 * - `{ext}` is the sanitized file extension (non-alphanumeric characters are
 *   stripped).
 */
function buildTempFilenameTemplate(filePath: string): string {
    const ext = extname(filePath)
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '')
    const base = basename(filePath, ext)
    const safeBase = base
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/X/g, '_')
        .slice(0, 60)
    const basePart = safeBase ? `${safeBase}_` : ''
    return `imsg_temp_${basePart}XXXXXXXXXX${safeExt}`
}

/**
 * Calculate delay based on file size
 * Small files: 2s, Medium files: 3s, Large files: 5s
 */
function calculateFileDelay(filePath: string): number {
    try {
        const fs = require('node:fs')
        const stats = fs.statSync(filePath)
        const sizeInMB = stats.size / (1024 * 1024)

        if (sizeInMB < 1) return 2 // < 1MB: 2 seconds
        if (sizeInMB < 10) return 3 // 1-10MB: 3 seconds
        return 5 // > 10MB: 5 seconds
    } catch {
        return 3 // Default to 3 seconds if file size check fails
    }
}

/**
 * Generate sandbox bypass script snippet
 *
 * Copy file to ~/Pictures/imsg_temp_* to bypass sandbox restrictions
 * Uses mktemp for atomic file creation (prevents TOCTOU attacks)
 * TempFileManager will auto-scan and clean these files
 */
function generateSandboxBypassScript(filePath: string): string {
    const escapedFilePath = escapeAppleScriptString(filePath)
    const escapedTemplate = escapeAppleScriptString(buildTempFilenameTemplate(filePath))
    const delay = calculateFileDelay(filePath)

    return `
    -- Bypass sandbox: atomic temp file creation with mktemp (prevents TOCTOU)
    set picturesFolder to POSIX path of (path to pictures folder)
    set targetPath to do shell script "mktemp " & quoted form of (picturesFolder & "${escapedTemplate}")
    do shell script "cat " & quoted form of "${escapedFilePath}" & " > " & quoted form of targetPath & " && chmod 600 " & quoted form of targetPath & " || { rm -f " & quoted form of targetPath & "; exit 1; }"
    
    -- Create file reference and send
    set theFile to (POSIX file targetPath) as alias
    send theFile to targetBuddy
    delay ${delay}
    `.trim()
}

/**
 * Generate sandbox bypass script snippet for chatId target
 * Uses mktemp for atomic file creation (prevents TOCTOU attacks)
 */
function generateSandboxBypassScriptForChat(filePath: string): string {
    const escapedFilePath = escapeAppleScriptString(filePath)
    const escapedTemplate = escapeAppleScriptString(buildTempFilenameTemplate(filePath))
    const delay = calculateFileDelay(filePath)

    return `
    -- Bypass sandbox: atomic temp file creation with mktemp (prevents TOCTOU)
    set picturesFolder to POSIX path of (path to pictures folder)
    set targetPath to do shell script "mktemp " & quoted form of (picturesFolder & "${escapedTemplate}")
    do shell script "cat " & quoted form of "${escapedFilePath}" & " > " & quoted form of targetPath & " && chmod 600 " & quoted form of targetPath & " || { rm -f " & quoted form of targetPath & "; exit 1; }"
    
    -- Create file reference and send
    set theFile to (POSIX file targetPath) as alias
    send theFile to targetChat
    delay ${delay}
    `.trim()
}

/**
 * Generate direct file send script snippet
 */
function generateDirectSendScript(filePath: string): string {
    const escapedPath = escapeAppleScriptString(filePath)
    const delay = calculateFileDelay(filePath)
    return `
    send POSIX file "${escapedPath}" to targetBuddy
    delay ${delay}
    `.trim()
}

/**
 * Generate direct file send script snippet for chatId target
 */
function generateDirectSendScriptForChat(filePath: string): string {
    const escapedPath = escapeAppleScriptString(filePath)
    const delay = calculateFileDelay(filePath)
    return `
    send POSIX file "${escapedPath}" to targetChat
    delay ${delay}
    `.trim()
}

/**
 * Generate AppleScript for sending attachment
 *
 * @param recipient Recipient
 * @param filePath Full path to attachment file
 * @param debug - Whether to output debug logs
 * @returns { script } - AppleScript code
 */
export const generateSendAttachmentScript = (
    recipient: string,
    filePath: string,
    debug = false
): { script: string } => {
    const escapedRecipient = escapeAppleScriptString(recipient)
    const needsBypass = needsSandboxBypass(filePath)

    if (needsBypass && debug) {
        console.log('[AppleScript] Non-sandbox directory detected, will temporarily copy to ~/Pictures')
    }

    const sendScript = needsBypass ? generateSandboxBypassScript(filePath) : generateDirectSendScript(filePath)

    return {
        script: `
tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "${escapedRecipient}" of targetService

${sendScript}
end tell
        `.trim(),
    }
}

/**
 * Generate AppleScript for sending attachment to a chat by chatId
 */
export const generateSendAttachmentToChat = (chatId: string, filePath: string, debug = false): { script: string } => {
    const escapedChatId = escapeAppleScriptString(chatId)
    const needsBypass = needsSandboxBypass(filePath)

    if (needsBypass && debug) {
        console.log('[AppleScript] Non-sandbox directory detected, will temporarily copy to ~/Pictures')
    }

    const sendScript = needsBypass
        ? generateSandboxBypassScriptForChat(filePath)
        : generateDirectSendScriptForChat(filePath)

    return {
        script: `
tell application "Messages"
    set targetChat to chat id "${escapedChatId}"

${sendScript}
end tell
        `.trim(),
    }
}

/**
 * Generate AppleScript for sending text with attachment
 *
 * Send text first, then attachment (also handles sandbox restrictions)
 *
 * @param recipient Recipient
 * @param text Message content
 * @param filePath Attachment file path
 * @returns { script } - AppleScript code
 */
export const generateSendWithAttachmentScript = (
    recipient: string,
    text: string,
    filePath: string
): { script: string } => {
    const escapedText = escapeAppleScriptString(text)
    const escapedRecipient = escapeAppleScriptString(recipient)
    const needsBypass = needsSandboxBypass(filePath)

    const attachmentScript = needsBypass ? generateSandboxBypassScript(filePath) : generateDirectSendScript(filePath)

    return {
        script: `
tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "${escapedRecipient}" of targetService

    -- Send text
    send "${escapedText}" to targetBuddy

    -- Send attachment
${attachmentScript}
end tell
        `.trim(),
    }
}

/**
 * Generate AppleScript for sending text with attachment to a chat by chatId
 */
export const generateSendWithAttachmentToChat = (
    chatId: string,
    text: string,
    filePath: string
): { script: string } => {
    const escapedText = escapeAppleScriptString(text)
    const escapedChatId = escapeAppleScriptString(chatId)
    const needsBypass = needsSandboxBypass(filePath)

    const attachmentScript = needsBypass
        ? generateSandboxBypassScriptForChat(filePath)
        : generateDirectSendScriptForChat(filePath)

    return {
        script: `
tell application "Messages"
    set targetChat to chat id "${escapedChatId}"
    
    -- Send text
    send "${escapedText}" to targetChat
    
    -- Send attachment
${attachmentScript}
end tell
        `.trim(),
    }
}
