/**
 * AppleScript construction and attachment precheck.
 *
 * Pure, side-effect-free functions that turn a send job into an
 * osascript-ready script string. The single fs call (`statSync` in
 * `inspectAttachment`) is a precheck, not a transport.
 */

import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import {
    MESSAGES_APP_SANDBOX_SAFE_DIRS,
    MESSAGES_APP_TEMP_FILE_PREFIX,
    MESSAGES_APP_TEMP_WRITE_DIR,
} from '../../domain/messages-app'

/** Absolute paths of TCC-safe directories. Resolved once at module load. */
const SANDBOX_SAFE_DIRS_ABS = MESSAGES_APP_SANDBOX_SAFE_DIRS.map((dir) => join(homedir(), dir))

/** Absolute path of the bypass-temp write directory. */
const TEMP_WRITE_DIR_ABS = join(homedir(), MESSAGES_APP_TEMP_WRITE_DIR)

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
// Types
// -----------------------------------------------

/** AppleScript send method. `buddy` for DM recipients, `chat` for group chats. */
export type SendMethod = 'buddy' | 'chat'

/**
 * Pre-computed facts about a local file about to be sent as an attachment.
 *
 * `needsBypass` is defined by the Messages.app sandbox policy (see
 * SANDBOX_SAFE_DIRS). Computing once upstream avoids re-scanning the path
 * while building the AppleScript.
 */
export interface ResolvedAttachment {
    readonly localPath: string
    readonly needsBypass: boolean
}

// -----------------------------------------------
// Attachment precheck
// -----------------------------------------------

/**
 * Inspect a local file once to produce everything the send pipeline needs.
 *
 * Throws when the path is missing (`statSync` ENOENT) or is not a regular
 * file — callers map that to a user-facing `SendError`.
 */
export function inspectAttachment(localPath: string): ResolvedAttachment {
    const stats = statSync(localPath)
    if (!stats.isFile()) {
        throw new Error(`Attachment is not a regular file: ${localPath}`)
    }
    const needsBypass = !SANDBOX_SAFE_DIRS_ABS.some((dir) => localPath.startsWith(`${dir}/`) || localPath === dir)
    return { localPath, needsBypass }
}

// -----------------------------------------------
// Script Builder
// -----------------------------------------------

/**
 * Build an AppleScript for sending a message via the Messages app.
 *
 * Uses the buddy method for DM recipients and the chat method for group chats.
 *
 * Transport selection — why buddy path hardcodes `service type = iMessage`:
 *   Messages.app's AppleScript `service type` enum contains only
 *   `iMessage` / `SMS` / `RCS` — there is no `any`. The transport-agnostic
 *   `any;+;` / `any;-;` prefix is a chat.db storage concept, not an
 *   AppleScript routing option. The chat method does accept `any;+;<guid>` /
 *   `any;-;<addr>`, but `chat id` only resolves EXISTING chats: a fresh DM to
 *   a never-contacted number errors with -1728 ("Can't get chat id ..."),
 *   so first-time DMs must go through the buddy path — and the buddy path
 *   requires picking a concrete `service type` enum value. We commit to
 *   iMessage; Messages.app may still auto-fall back to SMS/RCS at delivery
 *   time. The real transport only becomes observable after chat.db
 *   records it (read it from the confirmed `Message.service`).
 */
export function buildSendScript(params: {
    readonly method: SendMethod
    readonly identifier: string
    readonly text?: string
    readonly attachment?: ResolvedAttachment
}): string {
    const { method, identifier, text, attachment } = params
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

    if (attachment) {
        bodyLines.push(buildAttachmentSnippet(attachment, targetVar))
    }

    const body = bodyLines.join('\n\n')

    return `tell application "Messages"
${targetSetup}

${body}
end tell`
}

// -----------------------------------------------
// Internal
// -----------------------------------------------

function buildAttachmentSnippet(attachment: ResolvedAttachment, targetVar: string): string {
    return attachment.needsBypass
        ? buildSandboxBypassSnippet(attachment, targetVar)
        : buildDirectSendSnippet(attachment, targetVar)
}

/**
 * Copy the file into a uniquely-named temp directory under its original
 * basename, then send that path through Messages.app.
 *
 * Why a directory instead of a renamed temp file: `mktemp` only replaces
 * trailing X's, so we can't embed the original filename (Chinese / emoji /
 * spaces) in the template. `mktemp -d` gives a unique parent; the file
 * inside keeps its exact name, which is what the recipient sees.
 *
 * Why `cat >` instead of `cp`: drops xattr / quarantine / ACL so
 * Messages.app's sandbox can read the fresh file.
 */
function buildSandboxBypassSnippet(attachment: ResolvedAttachment, targetVar: string): string {
    const { localPath } = attachment
    const escapedFilePath = escapeAppleScriptString(localPath)
    const escapedTempDir = escapeAppleScriptString(TEMP_WRITE_DIR_ABS)
    const escapedBasename = escapeAppleScriptString(basename(localPath))

    return `    set tmpDir to do shell script "mktemp -d " & quoted form of "${escapedTempDir}/${MESSAGES_APP_TEMP_FILE_PREFIX}XXXXXXXXXX"
    set targetPath to tmpDir & "/${escapedBasename}"
    do shell script "cat " & quoted form of "${escapedFilePath}" & " > " & quoted form of targetPath & " && chmod 600 " & quoted form of targetPath & " || { rm -rf " & quoted form of tmpDir & "; exit 1; }"
    set theFile to (POSIX file targetPath) as alias
    send theFile to ${targetVar}`
}

function buildDirectSendSnippet(attachment: ResolvedAttachment, targetVar: string): string {
    const escapedPath = escapeAppleScriptString(attachment.localPath)
    return `    send POSIX file "${escapedPath}" to ${targetVar}`
}
