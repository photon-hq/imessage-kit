/**
 * macOS / Messages.app protocol facts.
 *
 * These values are not engineering tuning — they are fixed by macOS TCC
 * sandbox policy and Messages.app handling conventions.
 */

// -----------------------------------------------
// TCC sandbox
// -----------------------------------------------

/**
 * Home-relative directories an `osascript`-launched Messages.app process can
 * read without triggering a TCC consent prompt. Attachments outside this set
 * must be copied into one of these directories before being handed to
 * Messages.app.
 *
 * Source: macOS TCC policy for the Messages sandbox (observed on macOS 14+,
 * unchanged on macOS 26).
 */
export const MESSAGES_APP_SANDBOX_SAFE_DIRS = ['Pictures', 'Downloads', 'Documents'] as const

// -----------------------------------------------
// Temp files
// -----------------------------------------------

/**
 * File-name prefix used by the SDK when copying an attachment into a
 * sandbox-safe directory. The temp-files cleanup pass identifies SDK-owned
 * files by this prefix before deleting them, so it must stay stable.
 */
export const MESSAGES_APP_TEMP_FILE_PREFIX = 'imsg_temp_'

/**
 * Home-relative directory where the SDK writes bypass temp copies. Must
 * be one of {@link MESSAGES_APP_SANDBOX_SAFE_DIRS}. The write path
 * (applescript-builder), the cleanup pass (temp-files), and the sandbox
 * policy all read from this single constant.
 */
export const MESSAGES_APP_TEMP_WRITE_DIR = 'Pictures'
