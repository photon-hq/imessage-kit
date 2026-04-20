/**
 * Send request type.
 */

/** Arguments for `sdk.send()`. */
export interface SendRequest {
    /**
     * Recipient. One of:
     *   - Phone number (`+1234567890`) or email (`user@example.com`)
     *     for a DM.
     *   - A chatId shape returned by the SDK (e.g. `message.chatId` or
     *     `chat.chatId`) to reply to or continue an existing conversation.
     *
     * Group chatIds must come from the SDK — they encode Messages.app
     * internal GUIDs that cannot be reconstructed from user data.
     */
    readonly to: string

    /** Message body. Optional when `attachments` is non-empty. */
    readonly text?: string

    /**
     * Local file paths only. Download remote URLs yourself and pass
     * the resulting local path.
     *
     * Paths outside TCC-safe directories (`~/Pictures`, `~/Downloads`,
     * `~/Documents`) are copied into `~/Pictures/imsg_temp_*` before
     * AppleScript dispatch — the Messages.app sandbox rejects direct
     * attachment from arbitrary locations. The copies are removed by a
     * background cleanup pass (default: every 5 min, files older than
     * 10 min), NOT synchronously after send.
     */
    readonly attachments?: readonly string[]
}
