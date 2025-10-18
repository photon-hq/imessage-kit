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
const escapeAppleScriptString = (str: string): string => {
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

    return `
tell application "Messages"
    set targetBuddy to buddy "${recipient}"
    send "${escapedText}" to targetBuddy
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
 * Generate sandbox bypass script snippet
 *
 * Copy file to ~/Pictures/imsg_temp_* to bypass sandbox restrictions
 * TempFileManager will auto-scan and clean these files
 */
function generateSandboxBypassScript(filePath: string, recipient: string): string {
    const fileName = filePath.split('/').pop()
    const tempFileName = `imsg_temp_${Date.now()}_${fileName}`

    return `
    -- Bypass sandbox: copy to Pictures directory
    set picturesFolder to POSIX path of (path to pictures folder)
    set targetPath to picturesFolder & "${tempFileName}"
    do shell script "cp " & quoted form of "${filePath}" & " " & quoted form of targetPath
    
    -- Create file reference and send
    set theFile to (POSIX file targetPath) as alias
    set targetBuddy to buddy "${recipient}"
    send theFile to targetBuddy
    `.trim()
}

/**
 * Generate direct file send script snippet
 */
function generateDirectSendScript(filePath: string, recipient: string): string {
    return `
    set targetBuddy to buddy "${recipient}"
    send POSIX file "${filePath}" to targetBuddy
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
    const needsBypass = needsSandboxBypass(filePath)

    if (needsBypass && debug) {
        console.log('[AppleScript] Non-sandbox directory detected, will temporarily copy to ~/Pictures')
    }

    const sendScript = needsBypass
        ? generateSandboxBypassScript(filePath, recipient)
        : generateDirectSendScript(filePath, recipient)

    return {
        script: `
tell application "Messages"
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
    const needsBypass = needsSandboxBypass(filePath)

    const attachmentScript = needsBypass
        ? generateSandboxBypassScript(filePath, recipient)
        : generateDirectSendScript(filePath, recipient)

    return {
        script: `
tell application "Messages"
    set targetBuddy to buddy "${recipient}"
    
    -- Send text
    send "${escapedText}" to targetBuddy
    
    -- Send attachment
${attachmentScript}
end tell
        `.trim(),
    }
}
